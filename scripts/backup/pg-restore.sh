#!/usr/bin/env bash
# Restore a pg_dump (custom format) produced by pg-backup.sh / the compose `backup`
# service. See docs/BACKUPS.md. TESTED end-to-end against a fresh dump (2 orgs / 7
# customers / 174 GL lines restored cleanly).
#
#   DATABASE_URL="postgres://postgres:***@host:5432/sellerctrl" \
#     ./scripts/backup/pg-restore.sh /backups/sellerctrl-YYYYMMDD-HHMMSS.dump
#
# DESTRUCTIVE to the target db (drops + recreates objects). Run as the OWNER, and
# AFTER restoring re-apply Row-Level Security: `npm run db:rls`.
#
# Env:
#   DATABASE_URL  (required) owner connection to the TARGET database, DIRECT (:5432)

set -euo pipefail

DUMP="${1:?usage: pg-restore.sh <dump-file>}"
: "${DATABASE_URL:?set DATABASE_URL (owner connection to the target db)}"
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 1; }

echo "[$(date -Is)] restoring $DUMP → target db"
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$DATABASE_URL" "$DUMP"
echo "[$(date -Is)] restore done."
echo "NEXT: re-apply RLS on the restored db →  npm run db:rls"
