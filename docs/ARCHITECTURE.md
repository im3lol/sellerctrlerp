# Architecture

How Ctrl ERP is put together, for engineers picking up the project. Start with the
[README](../README.md) for setup; this document explains the *why* and the domain rules.

- [Big picture](#big-picture)
- [Multi-tenancy](#multi-tenancy)
- [Auth & authorization](#auth--authorization)
- [Accounting engine](#accounting-engine)
- [Inventory](#inventory)
- [The document cycle](#the-document-cycle)
- [Amazon / marketplace integration](#amazon--marketplace-integration)
- [Data layer & migrations](#data-layer--migrations)
- [Conventions & gotchas](#conventions--gotchas)
- [Deployment](#deployment)

---

## Big picture

A single Next.js 16 app is both frontend and backend:

- **Server Components** render pages and read data directly through Drizzle.
- **Server Actions** (`app/actions/**`, all `"use server"`) are the write layer.
- **`lib/erp/**`** holds the domain logic that actions and pages call. This is where the
  accounting/inventory rules live — keep business logic here, not in components.

Request flow for a typical ERP page:

```
proxy.ts (auth gate)
  → app/(app)/erp/<module>/page.tsx  (Server Component)
      → requireErpModule("<permission>")     // resolves active org + guards access
      → drizzle query scoped by organization_id
  → user submits a form → app/actions/erp/<x>.ts
      → authorizeErp("<permission>")          // re-checks on the write path
      → db.transaction(...) → lib/erp/posting.ts / inventory.ts
```

`proxy.ts` (formerly `middleware.ts`; renamed per Next 16) is the app-wide auth gate:
unauthenticated → `/login?callbackUrl=…`, authenticated users are bounced off the
landing/login pages to `/dashboard`.

---

## Multi-tenancy

One deployment serves many tenants. The tenant is an **organization**.

- Every ERP table has an `organization_id`. **Every query must filter by it.** Missing
  an org filter is the recurring bug class (IDOR / cross-tenant leakage).
- The **active org** is stored in the `erp_org` cookie. A user can belong to several orgs
  (`organization_members`) and switch between them via the org switcher in the topbar.
- `lib/erp/org.ts`:
  - `getActiveOrg()` — resolves the current org from the cookie.
  - `requireErpModule(permission)` — the page guard: resolves the org, checks the ERP
    role **and** the tenant's module entitlement, and redirects if either fails. Returns
    `{ orgId, role }`.
- **Module entitlements** (`lib/erp/entitlements.ts`, `org_subscriptions`): each tenant is
  subscribed to a subset of modules (`ALL_MODULES` in `lib/erp/module-list.ts`). Guards and
  navigation both consult `getEnabledModules(orgId)` so a tenant only sees what it pays for.

On the write side, `authorizeErp(permission)` in `app/actions/erp/*` does the equivalent
check for server actions and returns `{ orgId, userId, role }` for scoping + audit stamps.

---

## Auth & authorization

Two independent layers:

1. **OS auth (Auth.js v5).** `users` table, credentials provider (login by username **or**
   email), JWT sessions. `lib/session.ts` exposes `requireUser()` and
   `requireCapability(cap)`. Global roles + their capabilities live in `lib/rbac.ts`
   (`system_admin`, `ops_manager`, `team_lead`, `employee`, `client`). This gates OS-level
   things (user admin) and top-level nav visibility (`erp.*` capabilities).
2. **ERP org roles.** Within an org, `organization_members.role` + `lib/erp/permissions.ts`
   drive fine-grained ERP permissions (`sales.confirm`, `accounting.post`, …), enforced by
   `requireErpModule` / `authorizeErp`.

`auth.config.ts` is the DB-free slice used by `proxy.ts` (runs on the nodejs runtime).
`auth.ts` extends it with the Credentials provider whose `authorize()` touches Postgres and
verifies the password (`lib/erp/password.ts` supports bcrypt + legacy scrypt with rehash).

---

## Accounting engine

Double-entry, and **the general ledger is only ever written by one function**:
`postEntry(tx, { orgId, date, sourceType, sourceId, description, journalType, lines })` in
`lib/erp/posting.ts`.

- **Balanced or it throws.** Debits must equal credits, validated in integer cents to avoid
  float drift.
- **Idempotent.** A unique index on `(organization_id, source_type, source_id)` means posting
  the same source document twice is a no-op — safe to retry.
- **Numbered** `JV-YYYY-NNNN` via the atomic `nextDocumentNumber` sequence.
- **Reversible.** `reverseEntry` writes a mirror entry (swaps Dr/Cr); originals are never
  deleted or mutated.
- Posting respects the **fiscal period** — a `CLOSED` period rejects new entries.

Reports (`lib/erp/financials.ts`) aggregate posted lines: trial balance, income statement,
balance sheet, plus AR/AP aging and the general ledger drill-down.

### Standard chart of accounts (codes referenced throughout the code)

| Code | Account | | Code | Account |
|------|---------|-|------|---------|
| 1101 | Cash              | | 2101 | Accounts payable (موردون) |
| 1102 | Bank              | | 2102 | Output VAT |
| 1103 | Accounts receivable (عملاء) | | 2103 | Goods received not invoiced (GRNI) |
| 1104 | Inventory         | | 4101 | Sales revenue |
| 1107 | Input VAT         | | 4102 | Sales returns |
| 1108 | Amazon clearing (رصيد أمازون الوسيط) | | 5101 | COGS |
| | | | 5203 | Amazon fees (رسوم أمازون) |

Account resolution goes through `lib/erp/accounting-config.ts::resolveAccountIds`, which lets
a tenant remap the default code for any role (e.g. a different bank account) via
`accounting_configurations` — an empty config yields the defaults above.

---

## Inventory

Perpetual, weighted-average cost. **Stock only ever moves through one function**:
`postStockMovement(tx, …)` in `lib/erp/inventory.ts`.

- Types `IN` / `OUT` / `ADJ`, each updating a running `balance_quantity` / `balance_value`.
- **Negative stock is rejected** (`allowNegative` defaults false) — an OUT beyond on-hand throws.
- `currentStock(orgId, itemId, warehouseId)` returns on-hand qty + weighted-average cost.
- **Hard invariant:** the GL inventory account (1104) balance always equals the sum of the
  stock ledger's `balance_value`. The `scripts/checks/chk-*` scripts assert this.
- **Availability / reservations** (`lib/erp/availability.ts`): available = on-hand − reserved,
  where reserved = undelivered quantity of open sales orders. A sale that would oversell is
  blocked with a message naming the order that holds the stock.

The GL side (COGS) and the stock side are posted together but by their respective engines —
`postStockMovement` never touches the GL directly and `postEntry` never touches stock.

---

## The document cycle

Governed by `docs/ERP_DOCUMENT_CYCLE_MASTER_PLAN_AR.md` (the authoritative spec). Rules:

- **Save = Draft.** Creating a document has no GL/stock/balance effect.
- **Confirm = post.** A manual, atomic, idempotent action posts the effects and flips status
  `Draft → Confirmed/Posted`. Confirmed documents are immutable — correct them by
  cancel/reverse, never by editing.
- **No auto-chaining.** The next document in a chain is created by an explicit action, not a
  side effect. Documents link to their source (`document_links` + FK columns).
- **Partial execution.** Deliver/receive/invoice part of an order; status becomes
  `Partially …` until complete. Backorders are tracked per line.

### Sales flow

```
Sales Order ──confirm──▶ Delivery Note ──▶ Sales Invoice
 (reserve stock)        (stock OUT @ WAC   (Dr 1103 AR / Cr 4101
                         + COGS Dr 5101/    revenue / Cr 2102 VAT)
                         Cr 1104)
```

Returns reverse the chain: a **credit note** (مرتجع فاتورة) reverses revenue/VAT/AR, and a
**delivery return** (مرتجع إذن صرف) restocks + reverses COGS and drops the order's delivered
quantity. Purchases mirror this (PO → GRN → purchase invoice; GRNI account 2103 clears on
invoicing).

Every lifecycle action writes to the append-only **audit log** (`lib/erp/audit.ts`,
`audit_logs`), visible at `/erp/audit`.

---

## Amazon / marketplace integration

Sellers live on Amazon; the ERP ingests two Amazon reports. See
[`marketplace-order-import`] notes for the full accounting trace.

1. **Orders report** → `app/actions/erp/amazon-import.ts` + `lib/erp/amazon-import.ts`.
   One sales order per Amazon order (`channel=AMAZON`, `external_order_id`, deduped). SKU/ASIN
   resolve to items via `item_codes`. A `Shipped` order auto-runs order → delivery → posted
   invoice, so **revenue is recognized at the invoice**. Unmatched SKUs are reported and linked
   via the bulk SKU linker.
2. **Settlement report** ("Transaction view") → `app/actions/erp/amazon-settlement.ts`.
   Stored per line (`marketplace_settlement_txns`), deduped, and posted as **one aggregated
   journal** for released rows: Dr clearing (1108) + Dr fees (5203) + Dr bank (1102 transfers)
   + **Cr receivable (1103)**. It *collects* the AR the invoices created — it does **not**
   re-recognize revenue (that would double-count). Each `Refund` row auto-runs the full return
   cycle (credit note + delivery return), idempotent via `sales_return_id`.

---

## Data layer & migrations

- **Schema is code.** `db/schema.ts` (OS tables: `users`, `attendance`) re-exports
  `db/erp.ts` (all ERP tables). Money is `numeric`, PKs are `text`/uuid.
- **Migrations.** `db/migrations/` is the canonical drizzle-kit history. Workflow:
  edit the schema → `npm run db:generate` → review the SQL → `npm run db:migrate`.
- `db/seed.ts` builds a demo tenant: users, chart of accounts, warehouses, and a set of
  sample documents that leave the books balanced.
- `scripts/migrations/` holds *historical* one-off patches applied before the schema
  stabilized — already applied everywhere, kept for traceability. Don't re-run them.

---

## Conventions & gotchas

- **Latin digits only.** Never Arabic-Indic (٠١٢٣). Money → `toLocaleString("ar-EG-u-nu-latn")`,
  dates → `en-GB` (DD/MM/YYYY). `scripts/utils/scan-ar-digits.mjs` enforces it.
- **No `export type { X }` from `"use server"` files.** It compiles and works in dev but the
  Turbopack **production** build turns the re-export into a runtime `ReferenceError` on the
  first server-action call. Import the type directly where it's used.
- **Entity pickers are searchable comboboxes** (`CellCombobox`/`FormCombobox`), not `<select>`.
  Enums / short fixed lists stay as selects.
- **New purchase/sales documents follow the Draft→Confirm + recall-form pattern** and branch
  accounting by source — see `docs/ERP_DOCUMENT_CYCLE_MASTER_PLAN_AR.md`.

---

## Deployment

Two supported targets:

- **Vercel + Supabase (managed).** The live stack. `DATABASE_URL` points at the Supabase
  transaction pooler (port 6543). Item images use Supabase Storage (`SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY` + `SUPABASE_BUCKET`); `CRON_SECRET` guards `/api/cron`.
- **Docker (self-hosted).** `docker/docker-compose.yml` runs Postgres + MinIO + the app.
  The app image ships the **host-built** `.next/standalone` bundle. Rebuild flow:

  ```bash
  NODE_OPTIONS=--max-old-space-size=6144 npx next build          # host build (in-Docker OOMs)
  cp -r .next/static .next/standalone/.next/ \
    && cp -r public .next/standalone/ \
    && cp .env .next/standalone/.env
  docker compose -f docker/docker-compose.yml --profile app up -d --build app
  ```

Env is validated at boot by `lib/env.ts` — `DATABASE_URL` + `AUTH_SECRET` are required;
missing optional vars only warn.

[`marketplace-order-import`]: ../README.md
