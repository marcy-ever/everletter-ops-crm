# Backup — Local Rotation + Offsite (Backblaze B2)

Two layers: local rotating dumps on the NAS, plus an offsite copy to Backblaze B2 for disaster recovery (NAS loss, not just a bad import).

## Account ownership

The Backblaze B2 account is under **brad12s@gmail.com** (Brad's personal account), not Marcy's. This is a known deviation from the general "Marcy owns her own infrastructure" principle followed elsewhere in this project (GitHub, the NAS, DNS) — worth revisiting at some point if full independence from Brad matters for this specific piece, but not urgent given B2's cost is trivial and the account isn't tied to anything else Marcy needs to manage day to day.

## Backblaze B2 setup (already done — reference only)

1. Signed up at backblaze.com for a B2 Cloud Storage account.
2. Created a bucket named `everletter-backups`, Files in Bucket set to Private.
3. Created an Application Key named `everletter-backup-writer`, restricted to the `everletter-backups` bucket specifically (not "All").
4. **Access type: Read and Write** — not Write Only. Write Only was tried first and failed (see Gotchas below); Read and Write, still scoped to just this one bucket, is what actually works.
5. The resulting keyID and applicationKey are the credentials rclone uses (see Configuration below). Not committed anywhere — they live only in rclone's config file on the NAS.

## NAS installation (what actually worked)

DSM's shell is minimal — no `unzip`, no `busybox`. What worked:

​```bash
cd /tmp
curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip
python3 -m zipfile -e rclone-current-linux-amd64.zip .
cd rclone-*-linux-amd64
mkdir -p ~/bin
cp rclone ~/bin/rclone
chmod +x ~/bin/rclone
~/bin/rclone version
​```

**Do not install to `/usr/local/bin`** — that path is mounted `noexec` on this DSM. A file can have execute permission bits set there and still be refused execution by the kernel ("Permission denied" despite correct chmod). `~/bin` (under `/var/services/homes/twelves`, on the real data volume) works.

## Configuration

​```bash
~/bin/rclone config
​```

Interactive wizard answers:
- `n` (new remote)
- name: `b2backup`
- storage type: `b2`
- account (Key ID): the keyID from Backblaze
- key (Application Key): the applicationKey from Backblaze
- endpoint: leave blank
- hard_delete: leave default (`false`) — B2 "hides" deleted/overwritten files instead of permanently erasing them, which is the safer, recoverable behavior for a backup destination
- "Edit advanced config?": `n`
- confirm summary: `y`, then `q` to quit

Verify:
​```bash
~/bin/rclone lsd b2backup:
​```
Should list `everletter-backups` with no error.

## devops/backup.sh (current working version)

​```bash
#!/bin/bash
set -e

BACKUP_DIR=/var/services/homes/twelves/lyra/everletter-ops-crm/backups
DATE=$(date +%F_%H%M%S)
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
docker exec everletter-ops-crm_postgres_1 pg_dump -U everletter everletter_dev | gzip > "$BACKUP_DIR/everletter_${DATE}.sql.gz"
/var/services/homes/twelves/bin/rclone copy --no-check-dest "$BACKUP_DIR/everletter_${DATE}.sql.gz" b2backup:everletter-backups/
find "$BACKUP_DIR" -name "everletter_*.sql.gz" -mtime +$RETENTION_DAYS -delete
​```

Notes on the non-obvious parts:
- `BACKUP_DIR` uses the full absolute path, not `~` — DSM's Task Scheduler doesn't reliably resolve `~` to the same home directory an interactive SSH session does.
- rclone is invoked by its full absolute path (`/var/services/homes/twelves/bin/rclone`), not the bare command — it's not on `PATH` in the Task Scheduler execution context.
- `--no-check-dest` is required. Without it, rclone tries a HEAD-style existence check on the destination file before uploading, which fails with a 401 even against a Read-and-Write scoped key — B2's per-bucket restricted keys don't support that check. Safe to skip here because every filename is uniquely timestamped, so there's never a real "does this already exist" case.

## DSM Task Scheduler

**Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**
- Schedule: daily, 2:00 AM
- User: `twelves` (not root — matters for Docker permissions)
- Run command: `bash /var/services/homes/twelves/lyra/everletter-ops-crm/devops/backup.sh`

## Gotchas hit along the way (for context, not to repeat)

- **GCS was the original plan, abandoned entirely.** `theeverletter.com` is a Google Workspace domain, which auto-creates an invisible Cloud Identity Organization with default policies that blocked both IAM role grants and service account key creation — even for the project's own "owner." Switched to Backblaze B2 instead, which has no equivalent organization/policy layer.
- **B2 Application Key type: Write Only doesn't actually work with rclone.** It causes two different 401s in sequence — first on the per-file HEAD check (fixed by `--no-check-dest`), then on bucket resolution itself (rclone needs some read-level capability to resolve/verify the bucket exists before writing, which a true write-only key can't provide). Read and Write, still bucket-scoped, is the practical answer.