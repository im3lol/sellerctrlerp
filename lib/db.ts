import { AsyncLocalStorage } from "async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { SUPABASE_CA } from "@/lib/supabase-ca";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl";

// Reuse the pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

// Enable SSL for remote databases (e.g. Supabase). Local Docker Postgres has no SSL.
const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(connectionString);

// Remote: fully verify the TLS chain + hostname against the pinned Supabase CA.
// Escape hatch: DB_SSL_INSECURE=1 falls back to no-verify (e.g. a non-Supabase host).
const remoteSsl =
  process.env.DB_SSL_INSECURE === "1"
    ? { rejectUnauthorized: false }
    : { ca: SUPABASE_CA, rejectUnauthorized: true };

// Serverless (Vercel) runs many short-lived instances against the shared Supabase
// pooler. In SESSION mode the pooler holds one server connection per client for
// its whole life (budget ~15), so a single busy page (the dashboard fans out
// ~13 queries) plus a couple of warm instances can exhaust it (EMAXCONNSESSION).
// Keep the per-instance pool tiny and release idle sockets fast. The durable fix
// is to point DATABASE_URL at the TRANSACTION-mode pooler (port 6543).
const onVercel = !!process.env.VERCEL;

// Whether DATABASE_URL already points at the transaction-mode pooler. That mode
// hands a server connection back after each transaction instead of holding it for
// the client's life, so the ~15-connection budget stops being per-instance and a
// bigger local pool is safe.
//
// This matters more than it looks: at max=2 every `Promise.all` in the codebase is
// a lie — the dashboard's fan-out of ~11 queries runs as ~6 sequential rounds, so
// the concurrency the code is written for never happens. Raising the cap without
// moving to :6543 first would just exhaust the pooler instead.
const onTransactionPooler = /:6543\//.test(connectionString);

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString,
    max: onVercel ? (onTransactionPooler ? 10 : 2) : 10,
    ssl: isLocal ? undefined : remoteSsl,
    // Keep pooled sockets alive; avoids ECONNRESET on idle connections
    // (local Docker Postgres drops idle sockets).
    keepAlive: true,
    idleTimeoutMillis: onVercel ? 3_000 : 30_000,
    connectionTimeoutMillis: 15_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pgPool = pool;

/** The real Drizzle instance over the pool. Used directly ONLY by the scope wrappers
 *  (lib/db-scope.ts) to open the top-level per-request transaction; everything else
 *  imports the scope-routing `db` proxy below. */
export const realDb = drizzle(pool, { schema });

/** The transaction handle Drizzle hands to a `.transaction()` callback. */
export type ScopedTx = Parameters<Parameters<typeof realDb.transaction>[0]>[0];

/**
 * Per-request tenant scope. When set (by withOrgScope/withPlatformScope), it holds
 * the open transaction whose connection carries the `app.current_org` GUC that RLS
 * policies read. The `db` proxy routes every query onto this transaction, so a query
 * anywhere in the request is automatically tenant-scoped — no call-site changes.
 */
export const scopeStore = new AsyncLocalStorage<{ tx: ScopedTx }>();

/**
 * The Drizzle handle everything imports. It's a Proxy: while a request is inside a
 * tenant scope, every method (select/insert/update/delete/execute/transaction/…)
 * resolves against the scope's transaction — so the GUC set on that one connection is
 * in force. Outside any scope it falls through to `realDb` (the bare pool), which is
 * how dev scripts and startup code keep working, and — once RLS is enabled — makes an
 * unscoped query fail closed (no `app.current_org` → policies match nothing).
 */
export const db: typeof realDb = new Proxy(realDb, {
  get(target, prop) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source: any = scopeStore.getStore()?.tx ?? target;
    const value = source[prop];
    return typeof value === "function" ? value.bind(source) : value;
  },
});

export { schema };
