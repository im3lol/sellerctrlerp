# scripts/

One-off developer scripts. **None of these run in CI, Docker, or the build** — they
are invoked manually against a database. Most are TypeScript run with
[`tsx`](https://github.com/privatenumber/tsx); a few are `.mjs` or raw `.sql`.

```bash
# TypeScript (resolves the @/ path alias from tsconfig automatically)
npx tsx scripts/checks/chk-inventory.ts

# Node ESM utilities
node scripts/utils/scan-ar-digits.mjs

# Raw SQL migrations
psql "$DATABASE_URL" -f scripts/migrations/migrate-banking.sql
```

They read `DATABASE_URL` from the environment (or `.env`). Point it at your **local**
Docker Postgres unless you explicitly intend to touch a remote DB.

## checks/ — verification & repair

Ad-hoc scripts that assert the ERP's accounting invariants (books balanced,
`GL 1104 == inventory ledger`, WAC/FIFO integrity, document-cycle correctness).
Run inside a transaction and roll back — **except where noted below**.

> ⚠️ **`chk-returns.ts` and `chk-stock-ops.ts` COMMIT their changes.** Do not run
> them against a database whose state you care about. Prefer the rollback-safe
> checks (`chk-inventory`, `chk-sequence`, `chk-acct-config`, `verify-journal`, …).

## migrations/ — one-time schema/data patches (historical)

`alter-*`, `create-*`, `mig-*`, and `migrate-*.sql` files that were applied once
while the schema was being built out, **before** it stabilized into
`db/migrations/`. They are kept for history/traceability and are **already applied**
to every live database. The source of truth for the schema is
[`db/erp.ts`](../db/erp.ts) + [`db/schema.ts`](../db/schema.ts); the canonical
migration history is [`db/migrations/`](../db/migrations). Do not re-run these
unless you are provisioning a database that predates a specific patch.

## utils/ — repo-hygiene helpers (still useful)

- `scan-ar-digits.mjs` — fails if any UI file renders Arabic-Indic digits (٠١٢٣).
  The project convention is **Latin digits everywhere**; run this after adding UI.
- `fix-ar-digits.mjs` — auto-converts Arabic-Indic digit literals to Latin.
- `check-base.mjs` — misc sanity check.
