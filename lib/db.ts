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
// pooler, so keep a small per-instance pool and release idle sockets quickly to
// avoid exhausting the pooler's connection budget. A long-running server (Docker)
// can hold a larger pool.
const onVercel = !!process.env.VERCEL;

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString,
    max: onVercel ? 4 : 10,
    ssl: isLocal ? undefined : remoteSsl,
    // Keep pooled sockets alive; avoids ECONNRESET on idle connections
    // (local Docker Postgres drops idle sockets).
    keepAlive: true,
    idleTimeoutMillis: onVercel ? 10_000 : 30_000,
    connectionTimeoutMillis: 15_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
