import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5432/sellerctrl";

// Reuse the pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

// Enable SSL for remote databases (e.g. Supabase). Local Docker Postgres has no SSL.
const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(connectionString);

export const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString,
    max: 10,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
export { schema };
