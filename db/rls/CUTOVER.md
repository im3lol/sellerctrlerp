# RLS Production Cutover — Runbook

Flipping the running app from the table **owner** (bypasses RLS) to the non-owner
**`appuser`** (RLS enforced). Order matters; do the steps exactly as numbered.

Everything the app needs is already built and green locally: the scope wrappers on
every handler, the policies, migration 0050, and the leak test. This runbook is only
the infra flip — no code changes.

> **Reversible:** the whole thing is undone by flipping one Vercel env var back
> (step 6). The policies can stay in place; they simply don't filter the owner.

---

## Pre-flight (do NOT skip)

- **P0 — staging smoke as appuser.** Before touching prod, point a staging (or local)
  deploy's `DATABASE_URL` at `appuser` and confirm: log in → a few ERP pages render
  with data → create one record → an `/api/v1` call with an API key returns rows.
  This is the real end-to-end proof of the scope wiring; do it once.
  Locally: `docker` app already runs as the owner — rebuild with
  `DATABASE_URL=postgres://appuser:appuser@postgres:5432/sellerctrl` to reproduce prod.
- **Regression guard is green:** `npx tsx scripts/rls-unscoped-check.ts` → "no unscoped
  policied reads". Run it in CI so a future handler can't regress silently.

## The two roles

| Role | Used by | RLS |
|---|---|---|
| **owner** (`postgres.<ref>`) | migrations / DDL, via `MIGRATE_DATABASE_URL` | must BYPASS (see caveat) |
| **`appuser`** | the running app, via `DATABASE_URL` | ENFORCED (NOBYPASSRLS) |

---

## Steps (run SQL as `postgres` in the Supabase SQL editor)

**1. Create `appuser` + grants.** Use `db/rls/00-appuser.sql` but with a REAL secret
(never commit it). Run it **as the role that owns / will create the tables** — its
`ALTER DEFAULT PRIVILEGES` only covers objects created by that same role, so future
migrations' tables are auto-granted to `appuser` only if the migration owner ran this.

**2. Apply the schema for line tables — BEFORE the policies.** Run migration
`0050_line_org_denormalize.sql` (adds `organization_id` + backfill + `set_org` trigger).
It must run before step 3: the backfill is a data UPDATE, and once FORCE RLS is on it
would be row-filtered for a non-BYPASSRLS owner (see caveat). Order = backfill first.

**3. Enable the policies.** Run `db/rls/01-policies.sql` (67 org tables) then
`db/rls/02-line-policies.sql` (23 line tables). Idempotent.

**4. Wire the migration URL in Vercel.** Add `MIGRATE_DATABASE_URL` = the **owner** on a
**direct** connection (`…pooler.supabase.com:5432`, NOT the `:6543` transaction pooler —
DDL can't go through it). `drizzle.config.ts` already prefers it for `db:migrate`.

**5. Flip the app to `appuser`.** Set Vercel `DATABASE_URL` = the `appuser`
**transaction pooler** URI (`…:6543`). Redeploy. **RLS is now enforced.**

**6. Verify.** Log in as a real tenant, load pages, create a record, hit `/api/v1`.
If anything shows empty/blocked, go to Rollback.

## Rollback (one env var)

Set Vercel `DATABASE_URL` back to the **owner** URI and redeploy. The owner bypasses the
(still-present) policies → behaviour is exactly as before the cutover. Slower fallback:
`ALTER TABLE … DISABLE ROW LEVEL SECURITY` as owner.

---

## Operational caveats (from the pre-cutover review)

- **FORCE RLS applies to the owner too.** `FORCE ROW LEVEL SECURITY` means the table
  owner is subject to the policies **unless it has `BYPASSRLS`**. DDL is never
  row-filtered, but **data migrations** (backfills, seeds) on org tables would silently
  affect 0 rows for a non-BYPASSRLS owner. Two mitigations, use both:
  1. Order: run data-backfilling migrations **before** enabling policies (step 2 before 3).
  2. Grant the migration owner `BYPASSRLS` (`ALTER ROLE <owner> BYPASSRLS;`) so future
     data migrations aren't filtered — or have each such migration `SET LOCAL
     app.is_platform_admin = 'on';` at its top.
  Verify: `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('<owner>','appuser');`
  — owner should be `t`, **appuser must be `f`**.
- **Future tables need grants.** Any new table a migration creates must be granted to
  `appuser`. `ALTER DEFAULT PRIVILEGES` (step 1) handles this **only** if it was run by
  the same role that creates the tables. If migrations ever run as a different role,
  re-run the `GRANT … ON ALL TABLES` + `ALTER DEFAULT PRIVILEGES` block as that role.
- **New org tables must be policied.** When you add a table with `organization_id`, add
  it to `01-policies.sql` (or `02` if it's a denormalized line table) — otherwise it is
  readable across tenants. `scripts/rls-unscoped-check.ts` won't catch a missing policy;
  `scripts/rls-leak-check.ts` is where you'd add a coverage assertion.
- **Cron holds one connection for its whole run.** `/api/cron*` wraps the entire loop in
  `withPlatformScope` (one transaction across all orgs + SP-API fetches, up to
  `maxDuration`). Fine at current scale; if tenant count grows, scope per-org inside the
  loop instead. (Ties to the open pooler decision.)
