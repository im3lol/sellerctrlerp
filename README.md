# SellerCtrl Workspace OS

نظام داخلي لإدارة عمليات شركة SellerCtrl — **عربي بالكامل (RTL)** مع هوية SellerCtrl البصرية.

تحكم كامل في عملياتك من مكان واحد: إدارة الموظفين والعملاء والمنتجات والمهام، توزيع تلقائي للعمل، مراقبة الأداء، الحضور والانصراف، وربط مباشر مع Google Sheets.

## Tech Stack

> Self-hosted stack (chosen over the spec's Supabase/Vercel).

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, standalone) · React 19 · TypeScript |
| Styling | TailwindCSS v4 · shadcn/ui · font **ثمانية (Thmanyah)** |
| Database | PostgreSQL (Docker) · Drizzle ORM + drizzle-kit |
| Auth | Auth.js v5 (credentials, JWT, role-based) |
| Realtime | Postgres `LISTEN/NOTIFY` → Server-Sent Events |
| Storage | MinIO (S3-compatible) |
| Sheets | Google Sheets API (service account) |
| AI assistant | Anthropic Claude (`AI_MODEL`, default `claude-sonnet-4-6`) + heuristic fallback |
| Scheduling | node-cron (5-min Sheets sync, recurring tasks) |
| Charts | Recharts |

## Features (spec §1–§26)

Workspaces · Products table (locked/open columns) · customizable statuses · Google Sheets sync · auto-distribution (equal / performance / experience) · Tasks + Kanban (drag-and-drop) + recurring · Attendance (clock in/out, breaks, timers) · Notifications + realtime · Comments · Activity timeline · Audit log · File manager · KPIs · Leaderboard · Reports · Role-aware dashboards · Client portal · AI Operations Assistant · Marketing landing page.

### Roles (RBAC — `lib/rbac.ts`)
مدير النظام · مدير العمليات · قائد فريق · موظف · عميل (Seller)

## Getting Started

### 1. Start infrastructure (Postgres + MinIO + Adminer)

```bash
docker compose -f docker/docker-compose.yml up -d postgres minio minio-init adminer
```

- Postgres: `localhost:5432` (sellerctrl/sellerctrl)
- MinIO console: `localhost:9001` (minioadmin/minioadmin)
- Adminer (DB UI): `localhost:8080`

### 2. Configure environment

```bash
cp .env.example .env
# Generate an auth secret:
npx auth secret
```

Optional integrations (the app works without them):
- `GOOGLE_SERVICE_ACCOUNT_JSON` — enables Google Sheets sync
- `ANTHROPIC_API_KEY` — enables the AI assistant (otherwise a heuristic is used)

### 3. Install, migrate, seed

```bash
npm install
npm run db:migrate
npm run db:seed
```

### 4. Run

```bash
npm run dev
# http://localhost:3000
```

### Demo accounts (password: `password123`)

| Email | Role |
|---|---|
| admin@sellerctrl.com | مدير النظام |
| ops@sellerctrl.com | مدير العمليات |
| lead@sellerctrl.com | قائد فريق |
| ahmed@sellerctrl.com | موظف |
| client@sellerctrl.com | عميل (portal) |

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run db:generate` | Generate a migration from `db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Drizzle Studio |

## Deployment (Docker)

The app needs a long-lived Node server (SSE + Postgres `LISTEN/NOTIFY`), so it is **not** deployed to Vercel serverless. Build and run the full stack with Compose:

```bash
docker compose -f docker/docker-compose.yml --profile app up -d --build
```

Run migrations against the containerized DB before first use (`npm run db:migrate` with `DATABASE_URL` pointed at it, or as a one-shot job).

## Project Layout

```
app/(marketing)   public landing (app/page.tsx)
app/(auth)        login
app/(app)         internal app (RTL sidebar shell)
app/(client)      client/seller portal
app/api           realtime SSE, auth
lib/              db, auth, rbac, realtime, storage, sheets, sync, distribution, ai, cron
db/               schema, migrations, seed
components/       brand, app-shell, products, tasks, attendance, charts, …
docker/           docker-compose.yml, Dockerfile
```

## Design System

Primary `#0A33D1` · Secondary `#F7C52D` · Background `#FFFFFF` · Text `#101828` · cards `rounded-2xl` · RTL · font ثمانية.
