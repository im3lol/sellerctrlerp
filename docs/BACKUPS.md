# Backups — SellerCtrl / Ctrl ERP

Two independent layers. **Both matter** — layer 1 is the disaster safety net for
everyone; layer 2 is per-customer portability.

| Layer | What | Where | Protects |
|---|---|---|---|
| **1. Server-level** | Full-DB `pg_dump` nightly (+ optional WAL/PITR) | the Postgres host / cron | everyone, disaster recovery |
| **2. Per-tenant logical** | One org's rows → gzipped JSON | in the app (built-in) | one customer, export/restore/handoff |

---

## Layer 1 — server-level (the real safety net)

On the self-hosted server, run a nightly full dump. This is the primary recovery
mechanism and is **not** app code.

### Nightly dump

`scripts/backup/pg-backup.sh` takes a compressed custom-format dump with retention:

```bash
# one-off
DATABASE_URL="postgres://postgres:***@localhost:5432/sellerctrl" ./scripts/backup/pg-backup.sh

# nightly at 02:30 — add to the postgres user's crontab (`crontab -e`)
30 2 * * *  DATABASE_URL="postgres://postgres:***@localhost:5432/sellerctrl" BACKUP_DIR=/var/backups/sellerctrl KEEP_DAYS=14 /opt/sellerctrl/scripts/backup/pg-backup.sh >> /var/log/sellerctrl-backup.log 2>&1
```

Notes:
- Use the **owner/superuser** connection (`postgres`), not `appuser` — a dump must read
  every row; under RLS a non-BYPASSRLS role would dump nothing.
- Connect **direct** (`:5432`), not the transaction pooler (`:6543`).
- Set `OFFSITE_BUCKET` to also copy each dump to S3/MinIO (offsite is what saves you when
  the whole box dies). Restic/rclone to a second provider is even better.

### Restore (full DB)

```bash
# into a fresh/empty DB (recommended)
createdb sellerctrl_restore
pg_restore --no-owner --no-privileges --dbname="postgres://postgres:***@localhost:5432/sellerctrl_restore" backup.dump

# or overwrite in place (DESTRUCTIVE — drops+recreates objects)
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backup.dump
```
After a restore, re-run the RLS bootstrap if roles were lost: `db/rls/00-appuser.sql`
then `01-policies.sql` + `02-line-policies.sql` (see `db/rls/CUTOVER.md`).

### Point-in-time recovery (PITR) — optional, sub-day granularity

Nightly dumps lose up to a day. For finer recovery, enable WAL archiving:

1. `postgresql.conf`:
   ```
   wal_level = replica
   archive_mode = on
   archive_command = 'test ! -f /var/backups/wal/%f && cp %p /var/backups/wal/%f'
   ```
   (or ship WAL to S3 with wal-g / pgBackRest — recommended over raw `cp`).
2. Take a base backup: `pg_basebackup -D /var/backups/base -Ft -z -P`.
3. Recover: restore the base, set `recovery_target_time` in `postgresql.auto.conf`, drop a
   `recovery.signal`, start Postgres — it replays WAL up to that instant.

**pgBackRest** or **wal-g** automate all of the above (base + WAL + retention + offsite)
and are the production-grade choice; the raw commands here are the minimal path.

---

## Layer 2 — per-tenant logical backup (built into the app)

Every table carries `organization_id`, so one customer's data is a clean slice. This is
implemented in `lib/erp/backup.ts` and runs **inside the org's RLS scope** — the same
isolation boundary the app enforces.

**On-demand**
- Owner: `/admin/tenants/[id]` → «نسخة احتياطية» (any tenant) → `GET /admin/tenants/[id]/backup`.
- Tenant self-service: `/erp/settings` → «تحميل نسخة من بياناتي» → `GET /api/erp/backup`
  (gated `settings.edit` = org admin).
- Output: `backup-<orgId>-<ts>.json.gz` — `{ meta, data: { <table>: rows[] } }` for every
  org-scoped table (discovered from `information_schema`, so new tables are included).

**Scheduled**
- The daily cron (`/api/cron`) calls `backupOrgToStorage` for every org → object storage
  (`backups/<orgId>/<ts>.json.gz`), records a `backup_runs` row, then `pruneBackups` keeps
  the newest 14. History + signed-URL download on the tenant profile and `/erp/settings`.

**Restore one tenant** (from the JSON)
- There is no one-click importer yet (FK ordering + id-conflict handling on a live shared
  DB is the hard part). To restore/hand off a tenant today: create/empty the target org,
  then insert `data` table-by-table in FK order (parents before children; the
  `set_org` trigger fills line-table `organization_id`). Track building a guided importer
  as a follow-up.

> ponytail: the logical export loads each table fully into memory before gzipping and the
> cron backs up orgs sequentially — fine at current scale; a large fleet/tenant wants
> row-streaming + a queue. The server-level dump (layer 1) has no such limit.
