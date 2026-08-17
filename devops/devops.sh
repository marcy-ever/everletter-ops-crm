#!/bin/bash
set -euo pipefail

# Single definition of the Docker Compose invocation (two -f flags, -p,
# --project-directory, --env-file) that used to be duplicated across three
# package.json scripts and devops/deploy.sh, and getting it wrong is exactly
# what produced a confusing "POSTGRES_PASSWORD must be set" error during
# debugging - Compose interpolates every ${VAR} in whichever file(s) it's
# given, and that failure mode looks identical whether the real cause is a
# missing .env.local, an unset var inside it, or the wrong --project-directory
# entirely. Every operational entry point (package.json's docker:up/
# docker:up:full/docker:down, and this script's own subcommands) should call
# this file rather than restate any of those flags.
#
# Works from any directory on purpose (see SCRIPT_DIR/REPO_ROOT below) -
# `--project-directory` exists precisely so Compose's derived paths don't
# depend on the caller's cwd, and the debugging session that prompted this
# script ran the old duplicated invocation from the wrong place.
#
# Written to run on both a normal Linux dev box and Synology DSM (the NAS
# this app deploys to - see CLAUDE.md §4/§7). Deliberately avoids: `findmnt`
# (not assumed present), GNU-only flag variants (e.g. `readlink -f`,
# `date -d`), and treating /tmp as executable (docs/backups.md documents a
# real noexec mount on this DSM; devops/deploy.sh hit the same thing - see
# its own comment). `docker-compose` (hyphenated, v1) is used explicitly,
# matching every other script in this repo (devops/deploy.sh, package.json) -
# this codebase has never run compose v2's `docker compose` and introducing
# a second binary lookup path here isn't this task's job to speculate about.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env.local"

BASE_COMPOSE_FILE="$REPO_ROOT/devops/docker-compose.yml"
APP_COMPOSE_FILE="$REPO_ROOT/devops/docker-compose.app.yml"
PROJECT_NAME="everletter-ops-crm"

# Postgres-only invocation - the app compose file is deliberately never
# passed here, same reasoning as devops/docker-compose.yml's own header:
# Compose parses every ${VAR} in every -f file it's given regardless of
# which service actually starts, so including the app file would force
# AUTH_SECRET/GOOGLE_CLIENT_ID/etc. to be set just to start Postgres alone.
compose_base() {
  docker-compose -f "$BASE_COMPOSE_FILE" -p "$PROJECT_NAME" --project-directory "$REPO_ROOT" --env-file "$ENV_FILE" "$@"
}

# Full invocation (Postgres + app) - both -f flags are required together any
# time the app service is involved, because the app service's
# `depends_on: postgres` only resolves once Compose merges both files into
# one project (devops/docker-compose.app.yml's own header).
compose_full() {
  docker-compose -f "$BASE_COMPOSE_FILE" -f "$APP_COMPOSE_FILE" -p "$PROJECT_NAME" --project-directory "$REPO_ROOT" --env-file "$ENV_FILE" "$@"
}

# Fails with a specific, actionable message instead of letting Compose hit
# the file and surface its own "${VAR} must be set" interpolation error -
# that error looks identical whether the real problem is a missing
# .env.local or an unset var inside a present one, and only this check can
# tell the two apart before Compose ever runs.
require_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    echo "error: $ENV_FILE not found." >&2
    echo "  Copy .env.example to .env.local first (see CLAUDE.md's Local Setup section):" >&2
    echo "    cp \"$REPO_ROOT/.env.example\" \"$ENV_FILE\"" >&2
    exit 1
  fi
}

# Loads .env.local into this process's own environment - needed for
# subcommands (db-shell, db-clear, migrate) that talk to Postgres directly
# rather than only through Compose, which loads --env-file itself. Same
# `set -a; source ...; set +a` pattern CLAUDE.md's own setup instructions
# already use by hand, so a var missing here fails the same way a manual
# `pnpm db:migrate` run already would.
load_env_file() {
  require_env_file
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
}

# Resolves the running Postgres container's real name via Compose rather
# than hardcoding "everletter-ops-crm_postgres_1" - devops/deploy.sh's own
# comment explains why: compose v1 and v2 name containers differently, and
# this way subcommands work under either without knowing which is installed.
postgres_container() {
  local container
  container="$(compose_base ps -q postgres)"
  if [ -z "$container" ]; then
    echo "error: the postgres container isn't running. Try: $0 up" >&2
    exit 1
  fi
  echo "$container"
}

usage() {
  cat <<'USAGE'
Usage: devops/devops.sh <subcommand> [args]

  up          Start Postgres only, detached (no auth vars required)
  up-full     Start Postgres + the app container, detached (builds locally)
  down        Stop and remove both Postgres and the app container
  ps          Show container status
  logs [svc]  Follow logs (all services, or one: postgres | app)
  restart     Recreate the app container only (e.g. after a manual image pull)
  db-shell    Open an interactive psql session inside the Postgres container
  db-clear    TRUNCATE every normalized table - asks for confirmation first
  migrate     Run drizzle-kit migrate against DATABASE_URL from .env.local
  health      curl the app's /api/health endpoint and print the result

See docs/postgres.md for what each database-facing subcommand actually does
and the host-vs-container port gotcha (5433 vs 5432) that `migrate`
(host-side DATABASE_URL) depends on getting right - db-shell/db-clear are
unaffected, since docker exec runs psql inside the container itself.
USAGE
}

cmd_up() {
  require_env_file
  compose_base up -d
}

cmd_up_full() {
  require_env_file
  compose_full up -d --build
}

cmd_down() {
  require_env_file
  compose_full down
}

cmd_ps() {
  require_env_file
  compose_full ps
}

cmd_logs() {
  require_env_file
  compose_full logs -f "$@"
}

cmd_restart() {
  require_env_file
  # Deliberately `stop` + `rm -f` + `up -d`, not `up -d --force-recreate
  # app`. The two are supposed to be equivalent, but `--force-recreate`
  # makes docker-compose 1.29.2 inspect the *existing* container's image
  # config to preserve any anonymous volumes before replacing it - and
  # that inspection throws `KeyError: 'ContainerConfig'` against an image
  # built/pulled by a newer Docker Engine than this compose version's
  # docker-py understands (reproduced directly against both this repo's
  # own locally-built image and a plain upstream image, so it's a real
  # compose/Engine version mismatch, not something specific to this
  # project). `rm -f` first means there's no old container left to
  # inspect, so that code path never runs - same practical outcome (the
  # app service ends up freshly created), verified to actually work where
  # --force-recreate didn't. If the NAS's docker-compose/Docker Engine
  # pairing doesn't hit this bug, this sequence still behaves identically.
  compose_full stop app
  compose_full rm -f app
  compose_full up -d app
}

cmd_db_shell() {
  load_env_file
  local container
  container="$(postgres_container)"
  exec docker exec -it "$container" psql -U "${POSTGRES_USER:-everletter}" -d "${POSTGRES_DB:-everletter_dev}"
}

# Table list mirrors db/schema/'s barrel (db/schema/index.ts) exactly - every
# pgTable() this app defines, one place, so a table added to the schema and
# missed here doesn't silently survive a "clear everything" call. A single
# multi-table TRUNCATE handles the FK graph (subscriptions -> subscribers,
# orders/mailings -> subscriptions, mailing_components -> mailings,
# exceptions -> subscriptions/mailings, mailings -> staging_locations)
# without needing CASCADE, as long as every table on either side of a FK is
# in the same statement - which this list is.
DB_CLEAR_TABLES="subscribers, subscriptions, orders, mailings, mailing_components, exceptions, ingestion_events, audit_events, staging_locations"

cmd_db_clear() {
  load_env_file
  local container db_name
  container="$(postgres_container)"
  db_name="${POSTGRES_DB:-everletter_dev}"
  # Confirmation beyond what devops/clear_db.sh (the script this replaces)
  # had: that script only ever ran by hand, deliberately, against a dev
  # box. This one also runs on the NAS as a general ops entry point
  # alongside `migrate`/`restart`/etc, so a typo'd subcommand now has a much
  # easier path to a real database - worth one line of friction. All
  # current app data is disposable test data per CLAUDE.md, but that stops
  # being true once real customer data is live, and this script doesn't
  # know which situation it's running in.
  echo "About to TRUNCATE every normalized table in database '${db_name}' (container: ${container})."
  echo "Tables: ${DB_CLEAR_TABLES}"
  read -r -p "Type 'yes' to continue: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
  docker exec -i "$container" psql -U "${POSTGRES_USER:-everletter}" -d "$db_name" -c "TRUNCATE ${DB_CLEAR_TABLES};"
}

cmd_migrate() {
  load_env_file
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "error: DATABASE_URL is not set in $ENV_FILE" >&2
    exit 1
  fi
  # Run from REPO_ROOT regardless of caller's cwd - drizzle-kit needs its
  # own node_modules/config resolved from there, and pnpm resolves that from
  # the current directory, not from this script's own location.
  (cd "$REPO_ROOT" && pnpm db:migrate)
}

cmd_health() {
  local url="${1:-http://localhost:3100/api/health}"
  curl -sS "$url"
  echo
}

subcommand="${1:-}"
if [ $# -gt 0 ]; then shift; fi

case "$subcommand" in
  up) cmd_up ;;
  up-full) cmd_up_full ;;
  down) cmd_down ;;
  ps) cmd_ps ;;
  logs) cmd_logs "$@" ;;
  restart) cmd_restart ;;
  db-shell) cmd_db_shell ;;
  db-clear) cmd_db_clear ;;
  migrate) cmd_migrate ;;
  health) cmd_health "$@" ;;
  -h|--help|help|"") usage ;;
  *)
    echo "error: unknown subcommand '$subcommand'" >&2
    usage >&2
    exit 1
    ;;
esac
