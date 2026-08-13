# Ctrl ERP

A multi-tenant **ERP web application** for marketplace (Amazon / Noon) sellers.
Full double-entry accounting, perpetual inventory, and the complete sales &
purchase document cycle — with a fully **Arabic, right-to-left** UI.

> The codebase and comments are in English; the product UI is in Arabic. This
> README and [`docs/`](docs/) are in English so any engineer can onboard quickly.

---

## Tech stack

| Concern      | Choice |
|--------------|--------|
| Framework    | Next.js 16 (App Router, Turbopack, `output: standalone`) · React 19 · TypeScript |
| Styling      | TailwindCSS · shadcn/ui (Radix) · Thmanyah (ثمانية) font |
| Database     | PostgreSQL · [Drizzle ORM](https://orm.drizzle.team) + drizzle-kit |
| Auth         | Auth.js v5 — credentials (username **or** email), JWT sessions, role-based |
| Object store | MinIO (local) / Supabase Storage (on Vercel) — item images |
| Charts       | Recharts |
| Tests        | Vitest |

There is **no** CRM, scraping, desktop app, or AI layer — this repo is ERP-web only.

---

## Quick start (local)

**Prerequisites:** Node 20+, Docker (for Postgres + MinIO).

```bash
# 1. Install deps
npm install

# 2. Configure env — copy the template and set AUTH_SECRET
cp .env.example .env
npx auth secret          # writes AUTH_SECRET; DATABASE_URL default points at local Docker

# 3. Start infra (Postgres :5432, MinIO :9000/:9001, Adminer :8080)
docker compose -f docker/docker-compose.yml up -d postgres minio minio-init adminer

# 4. Create the schema + demo data
npm run db:migrate       # appuser role + the full migration chain
npm run db:rls           # tenant-isolation policies + integrity triggers
npm run db:seed

# 5. Run
npm run dev              # http://localhost:3000
```

**Default login:** `admin` / `password123` (all seeded users share that password).

### Production build locally (fast — recommended for perf checks)

`next dev` cold-compiles routes on demand and is slow on this repo. To profile the
real thing, run the standalone production server:

```bash
npm run build
cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && cp .env .next/standalone/.env
cd .next/standalone && PORT=3011 NODE_ENV=production AUTH_TRUST_HOST=true node server.js
```

### Docker (containerized app)

```bash
docker compose -f docker/docker-compose.yml --profile app up -d --build app   # → http://localhost:3000
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deployment) for the Docker rebuild
flow and the Vercel + Supabase deployment model.

---

## Project structure

```
app/
  (app)/            Authenticated app shell (sidebar + topbar + org switcher)
    dashboard/      Landing — ERP module tiles
    erp/            The ERP itself, one folder per module:
                    accounting · inventory · sales · purchases ·
                    investors · hr · reports · audit · imports · settings
    admin/          OS user management
    profile/
  (auth)/           login (+ admin emergency login)
  (print)/          Print-only layouts (invoices, orders, receipts, barcodes)
  actions/          Server actions ("use server") — actions/erp/* is the write layer
  api/              Route handlers: auth, cron (no-op), CSV/ledger exports, init-accounting

components/
  app-shell/        Nav config, sidebar, topbar, org switcher
  erp/              ERP UI (forms, tables, managers) — ~70 components
  ui/               shadcn/ui primitives

lib/
  erp/              ERP domain logic (see below) — the heart of the app
  db.ts             Drizzle client (pooled pg)
  session.ts        requireUser / requireCapability (OS auth)
  rbac.ts           Global role → capability matrix
  storage.ts        S3/MinIO or Supabase-Storage object storage
  env.ts            Boot-time env validation

db/
  schema.ts         OS tables (users, attendance) + re-exports erp.ts
  erp.ts            All ERP tables (Drizzle)
  migrations/       Canonical drizzle-kit migration history
  seed.ts           Demo tenant + chart of accounts + sample docs

scripts/            Manual dev scripts (see scripts/README.md) — not in build/CI
docs/               Architecture + Arabic planning specs
docker/             docker-compose + Dockerfiles
```

### `lib/erp/` — the domain core

| File | Responsibility |
|------|----------------|
| `posting.ts`        | Double-entry engine — `postEntry` / `reverseEntry` (balanced, idempotent) |
| `inventory.ts`      | Perpetual stock — `postStockMovement` (weighted-average cost), `currentStock` |
| `financials.ts`     | Trial balance, income statement, balance sheet |
| `org.ts`            | Active-org resolution + `requireErpModule` page guard |
| `action-auth.ts`    | `authorizeErp(permission)` for server actions |
| `entitlements.ts`   | Per-tenant module subscriptions |
| `sequence.ts`       | Atomic document numbering (SO-2026-0001 …) |
| `amazon-import.ts` / `amazon-settlement.ts` | Amazon order + settlement import & accounting |

---

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest

npm run db:generate  # generate a migration from schema changes
npm run db:migrate   # appuser role + apply the migration chain
npm run db:rls       # (re)apply RLS policies + integrity triggers — after every migrate
npm run db:baseline  # once, on a DB built by the old `push` flow (see ARCHITECTURE)
npm run db:studio    # drizzle studio
npm run db:seed      # reseed demo data
```

---

## Key concepts (one paragraph each — full detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md))

- **Multi-tenancy.** Every ERP row is scoped by `organization_id`. The active org
  comes from the `erp_org` cookie; `requireErpModule()` resolves + guards it. **Always
  scope Drizzle queries by org** — cross-tenant leakage (IDOR) is the main bug class.
- **Accounting.** Nothing hits the general ledger except `postEntry`, which validates
  the entry balances (in integer cents) and is idempotent per `(org, sourceType, sourceId)`.
- **Inventory.** Nothing moves stock except `postStockMovement` (weighted-average cost).
  Negative stock is rejected. `GL 1104 == inventory-ledger value` is a hard invariant.
- **Document cycle.** Saving a document creates a **Draft**; a manual **Confirm** posts
  its GL/stock effects atomically. Documents link to their source (order → delivery →
  invoice; returns reverse the chain).

---

## Conventions & gotchas

- **Latin digits everywhere.** Never render Arabic-Indic numerals (٠١٢٣). Use
  `toLocaleString("ar-EG-u-nu-latn", …)` for money and `en-GB` for dates. Run
  `node scripts/utils/scan-ar-digits.mjs` after touching UI.
- **`"use server"` files must not re-export imported types.** `export type { X }`
  from an action file passes `tsc` and dev, but the Turbopack **production** build
  turns it into a runtime `ReferenceError` on action invocation. Import the type where needed instead.
- **Read the Next.js docs first.** This is Next 16 with breaking changes vs. older
  versions — the vendored guides live in `node_modules/next/dist/docs/` (see `AGENTS.md`).
