#!/bin/bash
set -e
export PATH="/usr/local/bin:$PATH"

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
    log "docker-compose.yml changed - full down/up..."
    $COMPOSE down
    $COMPOSE pull
    $COMPOSE up -d
else
    log "No compose changes - pulling and recreating app only..."
    $COMPOSE pull app
    $COMPOSE up -d app
fi

success "Everletter deploy completed!"
