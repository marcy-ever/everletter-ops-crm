#!/bin/bash
set -e
export PATH="/usr/local/bin:$PATH"

# This script's own repo gets `git reset --hard`'d below, and bash reads a
# running script incrementally by byte offset from disk - if `git reset`
# replaces this file with a different-length version mid-run, bash can jump
# to the wrong byte offset and execute garbage. Copying self to a stable temp
# path and re-execing from there, before anything touches git, means the
# running process is reading a file `git reset` can never overwrite.
if [ -z "${DEPLOY_SH_REEXEC:-}" ]; then
  TMP_SELF="$(mktemp /tmp/everletter-deploy.XXXXXX.sh)"
  cp "$0" "$TMP_SELF"
  chmod +x "$TMP_SELF"
  DEPLOY_SH_REEXEC=1 exec "$TMP_SELF" "$@"
fi
trap 'rm -f "$0"' EXIT

DATE=$(date +%F_%H:%M:%S)
REPO_DIR=~/lyra/everletter-ops-crm
LOGFILE="${REPO_DIR}/devops/deploy.txt"

log()     { local msg="[${DATE}] $*";          echo "$msg"; echo "$msg" >> "$LOGFILE"; }
success() { local msg="[${DATE}] SUCCESS: $*"; echo "$msg"; echo "$msg" >> "$LOGFILE"; }
failure() { local msg="[${DATE}] FAILURE: $*"; echo "$msg" >&2; echo "$msg" >> "$LOGFILE"; }

cd "$REPO_DIR"
trap 'failure "Everletter deploy failed at line: ${LINENO}."' ERR

log "=== Everletter deploy started ==="
git fetch
COMPOSE_CHANGED=$(git diff HEAD..origin/main --name-only -- devops/docker-compose.yml devops/docker-compose.app.yml | wc -l)
git reset --hard origin/main

COMPOSE="docker-compose -f devops/docker-compose.yml -f devops/docker-compose.app.yml -p everletter-ops-crm --project-directory . --env-file .env.local"

if [ "$COMPOSE_CHANGED" -gt "0" ]; then
    log "compose files changed - full down/up..."
    $COMPOSE down
    $COMPOSE pull
    $COMPOSE up -d
else
    log "No compose changes - pulling and recreating app only..."
    $COMPOSE pull app
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

success "Everletter deploy completed! App container is healthy."
