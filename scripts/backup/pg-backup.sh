#!/usr/bin/env bash
# Nightly full-database backup (compressed custom format) + retention + optional offsite.
# See docs/BACKUPS.md. Run as the postgres user / a role that can read every row
# (the OWNER, not appuser — RLS would hide rows from a non-BYPASSRLS role).
#
#   DATABASE_URL="postgres://postgres:***@localhost:5432/sellerctrl" ./scripts/backup/pg-backup.sh
#
# Env:
#   DATABASE_URL   (required) owner/superuser connection, DIRECT (:5432, not the :6543 pooler)
#   BACKUP_DIR     (default /var/backups/sellerctrl)
#   KEEP_DAYS      (default 14) prune dumps older than this
#   OFFSITE_BUCKET (optional) also `aws s3 cp` each dump here — offsite is what saves you

set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (owner connection, direct :5432)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sellerctrl}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/sellerctrl-$STAMP.dump"

echo "[$(date -Is)] dumping → $FILE"
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --dbname="$DATABASE_URL" --file="$FILE"
echo "[$(date -Is)] wrote $FILE ($(du -h "$FILE" | cut -f1))"

# Retention: delete local dumps older than KEEP_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -name 'sellerctrl-*.dump' -mtime +"$KEEP_DAYS" -print -delete

# Offsite copy (best-effort — a local-only backup dies with the box).
if [ -n "${OFFSITE_BUCKET:-}" ]; then
  echo "[$(date -Is)] offsite → s3://$OFFSITE_BUCKET/db/"
  aws s3 cp "$FILE" "s3://$OFFSITE_BUCKET/db/" || echo "WARN: offsite copy failed"
fi

echo "[$(date -Is)] done"
