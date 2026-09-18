#!/usr/bin/env bash
# Restore drill: proves last night's dump actually restores. Spins a throwaway postgres,
# pg_restores the newest dump from the backup volume into it, then compares row counts of
# the core tables against production. Read-only on prod; the scratch container is removed.
#
#   bash scripts/restore-drill.sh
# Restored counts may trail prod by whatever was written since the dump — that's expected.
# FAIL = pg_restore errored, or a table prod has rows in came back empty.
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash would rewrite the in-container /backups paths

VOL="${BACKUP_VOLUME:-docker_dbbackups}"
NAME="sellerctrl-restore-drill"
TABLES="organizations users customers items sales_orders sales_invoices purchase_invoices journal_entries journal_entry_lines stock_movements"

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

DUMP="$(docker run --rm -v "$VOL":/backups:ro postgres:16-alpine sh -c 'ls -t /backups/sellerctrl-*.dump | head -1')"
[ -n "$DUMP" ] || { echo "❌ no dump found in volume $VOL"; exit 1; }
echo "▶ dump: $DUMP"

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill -v "$VOL":/backups:ro postgres:16-alpine >/dev/null
for _ in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -d drill >/dev/null 2>&1 && break; sleep 1; done
sleep 2 # the entrypoint restarts postgres once after init

start=$(date +%s)
docker exec "$NAME" pg_restore -U postgres -d drill --no-owner --no-privileges --exit-on-error "$DUMP"
echo "▶ restored in $(( $(date +%s) - start ))s"

count() { docker exec "$1" psql -U "$2" -d "$3" -Atc "select count(*) from $4"; }
fail=0
printf '%-22s %10s %10s\n' table prod restored
for t in $TABLES; do
  p="$(count sellerctrl-postgres sellerctrl sellerctrl "$t")"
  r="$(count "$NAME" postgres drill "$t")"
  mark=""; if [ "$p" -gt 0 ] && [ "$r" -eq 0 ]; then mark="  ❌"; fail=1; fi
  printf '%-22s %10s %10s%s\n' "$t" "$p" "$r" "$mark"
done

[ "$fail" -eq 0 ] && echo "✅ restore drill passed" || { echo "❌ restore drill FAILED"; exit 1; }
