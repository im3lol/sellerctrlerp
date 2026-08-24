import { AsyncLocalStorage } from "async_hooks";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl";

// Reuse the pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

// Enable TLS for remote databases. Local Docker Postgres has none.
const isLocal = /@(localhost|127[.]0[.]0[.]1|postgres)[:/]/.test(connectionString);

// Remote: verify the chain against the system CA store. This used to pin Supabase's CA,
// which was right while Supabase was the only remote target and wrong the moment it
// stopped being one — a pinned CA rejects every other provider. DB_SSL_INSECURE=1 stays
// the escape hatch for a self-signed certificate (a private VPS Postgres); it is the only
// way to turn verification off, so there is no silent downgrade.
const remoteSsl =
  process.env.DB_SSL_INSECURE === "1" ? { rejectUnauthorized: false } : true;

// One long-lived process per container, so a real pool is safe: every Promise.all in the
// codebase (the dashboard fans out ~11 queries) actually runs concurrently. The tiny
// max=2 this used to fall back to existed for serverless instances sharing a Supabase
// session pooler — it made those Promise.alls a lie, running them in sequential rounds.
export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: isLocal ? undefined : remoteSsl,
    // Keep pooled sockets alive; avoids ECONNRESET on idle connections
    // (local Docker Postgres drops idle sockets).
    keepAlive: true,
    idleTimeoutMillis: 30_000,
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
