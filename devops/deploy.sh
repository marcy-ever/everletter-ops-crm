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

success "Everletter deploy completed!"
