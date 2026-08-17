#!/bin/bash
set -e
export PATH="/usr/local/bin:$PATH"

# Log setup and the log/failure/success helpers come before the re-exec
# block below, deliberately - they used to come after it. A failure inside
# the re-exec block itself (the noexec incident this comment used to
# describe alone - see the block's own comment now) died completely
# silently as far as deploy.txt was concerned: LOGFILE wasn't defined yet,
# so there was nothing to write to. deploy.txt showed nothing at all for a
# week while deploys were actually failing on line 15, every time, looking
# indistinguishable from "no deploy was attempted." This ERR trap now
# covers the whole script, re-exec included, so any failure before or after
# it gets the same real, timestamped line in deploy.txt.
DATE=$(date +%F_%H:%M:%S)
REPO_DIR=~/lyra/everletter-ops-crm
LOGFILE="${REPO_DIR}/devops/deploy.txt"

log()     { local msg="[${DATE}] $*";          echo "$msg"; echo "$msg" >> "$LOGFILE"; }
success() { local msg="[${DATE}] SUCCESS: $*"; echo "$msg"; echo "$msg" >> "$LOGFILE"; }
failure() { local msg="[${DATE}] FAILURE: $*"; echo "$msg" >&2; echo "$msg" >> "$LOGFILE"; }

trap 'failure "Everletter deploy failed at line: ${LINENO}."' ERR

# This script's own repo gets `git reset --hard`'d below, and bash reads a
# running script incrementally by byte offset from disk - if `git reset`
# replaces this file with a different-length version mid-run, bash can jump
# to the wrong byte offset and execute garbage. Copying self to a stable temp
# path and re-execing from there, before anything touches git, means the
# running process is reading a file `git reset` can never overwrite.
#
# `exec bash "$TMP_SELF"`, not `exec "$TMP_SELF"`: on the NAS, /tmp is a
# noexec mount - the kernel refuses to exec a file there regardless of its
# permission bits (exit 126, "Permission denied", even immediately after
# chmod +x - the same DSM behavior docs/backups.md documents for a
# different path). Invoking bash explicitly and handing it the script as an
# ordinary argument sidesteps that entirely: bash itself lives on an
# executable mount, and reading a file's contents to interpret is not the
# same syscall as exec()'ing it, so noexec never enters into it. No chmod
# needed either, for the same reason - nothing here ever exec()s this file
# directly.
if [ -z "${DEPLOY_SH_REEXEC:-}" ]; then
  TMP_SELF="$(mktemp /tmp/everletter-deploy.XXXXXX.sh)"
  cp "$0" "$TMP_SELF"
  DEPLOY_SH_REEXEC=1 exec bash "$TMP_SELF" "$@"
fi
trap 'rm -f "$0"' EXIT

cd "$REPO_DIR"

log "=== Everletter deploy started ==="
git fetch
COMPOSE_CHANGED=$(git diff HEAD..origin/main --name-only -- devops/docker-compose.yml devops/docker-compose.app.yml | wc -l)
git reset --hard origin/main

COMPOSE="docker-compose -f devops/docker-compose.yml -f devops/docker-compose.app.yml -p everletter-ops-crm --project-directory . --env-file .env.local"

# Migrations run as a one-off against the freshly pulled image, before the
# new app container starts serving traffic - not at container start, and
# not skipped entirely (which is how this repo ended up running for weeks
# against a database that still had the old, pre-migration schema and
# nothing to show for it - see app/api/health/route.ts and CLAUDE.md §7/§8).
# `compose run --rm app` starts postgres first if it isn't already running
# (verified directly: it respects the app service's own `depends_on:
# postgres: condition: service_healthy`, waiting for it) and uses that same
# service's own `environment:` block for DATABASE_URL - the correct
# container-internal one, not a host-side value this script would have to
# get right itself. A failed migration here is a real command failure under
# `set -e`, so the existing `trap ... ERR` above fails the whole deploy
# loudly, before anything user-facing changes - not a container that boots,
# passes its healthcheck, and breaks on first real write. See
# devops/migrate/migrate.mjs's own header for why this needs its own image
# stage rather than reusing `drizzle-kit` (no Node toolchain lives on the
# NAS at all - it only ever pulls this same image).
if [ "$COMPOSE_CHANGED" -gt "0" ]; then
    log "compose files changed - full down/up..."
    $COMPOSE down
    $COMPOSE pull
    log "Applying database migrations before starting the new app container..."
    $COMPOSE run --rm app node devops/migrate/migrate.mjs
    $COMPOSE up -d
else
    log "No compose changes - pulling and recreating app only..."
    $COMPOSE pull app
    log "Applying database migrations before starting the new app container..."
    $COMPOSE run --rm app node devops/migrate/migrate.mjs
    $COMPOSE up -d app
fi

# `up -d` returning zero only means Docker accepted the container, not
# that Next booted or can reach Postgres - devops/docker-compose.app.yml's
# healthcheck (app/api/health/route.ts) is the actual proof, so wait for
# it before ever logging SUCCESS.
#
# Resolved via `$COMPOSE ps -q app` rather than a hardcoded container
# name (unlike devops/backup.sh's `everletter-ops-crm_postgres_1`,
# deliberately not copied here) - compose v1/v2 name containers
# differently, and this way the script works under either.
#
# Every command that can fail inside this loop is deliberately guarded
# (`|| true`, `|| echo ...`) so a transient/expected non-healthy read
# doesn't trip `set -e` and abort the script before the timeout is
# actually reached - only the final, real failure at the bottom is meant
# to do that.
HEALTH_TIMEOUT_SECONDS=120
HEALTH_POLL_INTERVAL_SECONDS=5
elapsed=0
health_status="unknown"
app_healthy=0

log "Waiting up to ${HEALTH_TIMEOUT_SECONDS}s for the app container to report healthy..."
while [ "$elapsed" -lt "$HEALTH_TIMEOUT_SECONDS" ]; do
    app_container="$($COMPOSE ps -q app || true)"
    if [ -n "$app_container" ]; then
        health_status="$(docker inspect --format='{{.State.Health.Status}}' "$app_container" 2>/dev/null || echo "unknown")"
        if [ "$health_status" = "healthy" ]; then
            app_healthy=1
            break
        fi
        if [ "$health_status" = "unhealthy" ]; then
            log "App container reported unhealthy after ${elapsed}s - not waiting out the rest of the timeout."
            break
        fi
    fi
    sleep "$HEALTH_POLL_INTERVAL_SECONDS"
    elapsed=$((elapsed + HEALTH_POLL_INTERVAL_SECONDS))
done

if [ "$app_healthy" -ne 1 ]; then
    log "App container did not become healthy (last status: ${health_status}, waited ${elapsed}s) - capturing logs before failing..."
    # --tail must come before the service name - docker-compose 1.29.2
    # (verified directly against the version this was tested with)
    # rejects `logs app --tail=50` as "No such service: --tail=50" if the
    # flag comes after the service argument.
    $COMPOSE logs --tail=50 app >> "$LOGFILE" 2>&1 || true
    # A real command failure, not a bare `exit 1` - this is what makes
    # the existing `trap ... ERR` above fire failure() with its usual
    # message, the same mechanism every other failure in this script
    # already relies on, instead of a second, inconsistent failure path.
    false
fi

# Logs *what* just deployed, not just that something did - deploy.txt
# otherwise records "a deploy happened" with nothing to reconstruct "when
# did this break" against later. Fetched via `docker exec` + node's own
# fetch (same pattern the healthcheck itself already uses, see
# devops/docker-compose.app.yml - no curl/wget on this image or assumed on
# the host), against the app container confirmed healthy above, so this
# read never races the boot this script just waited out. Logs the raw
# JSON body as-is (buildTime/commitSha from lib/build-info.ts) rather than
# parsing fields out in bash - simpler, and a missing/renamed field shows
# up directly in the log instead of silently becoming "unknown".
version_body="$($COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => r.text()).then((t) => process.stdout.write(t)).catch(() => process.stdout.write('{}'))" 2>/dev/null || echo '{}')"
success "Everletter deploy completed! App container is healthy. Version: ${version_body}"
