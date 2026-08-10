#!/bin/bash
set -e

BACKUP_DIR=/var/services/homes/twelves/lyra/everletter-ops-crm/backups
DATE=$(date +%F_%H%M%S)
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
docker exec everletter-ops-crm_postgres_1 pg_dump -U everletter everletter_dev | gzip > "$BACKUP_DIR/everletter_${DATE}.sql.gz"
/var/services/homes/twelves/bin/rclone copy "$BACKUP_DIR/everletter_${DATE}.sql.gz" b2backup:everletter-backups/
find "$BACKUP_DIR" -name "everletter_*.sql.gz" -mtime +$RETENTION_DAYS -delete
