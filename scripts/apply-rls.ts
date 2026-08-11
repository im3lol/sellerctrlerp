/**
 * Apply Row-Level Security reproducibly: the appuser role + tenant-isolation policies
 * on every org + line table. Run as the DB OWNER (migrations role), which is why this
 * is separate from the app's runtime connection.
 *
 *   npm run db:rls                    # local Docker (owner on :5433)
 *   MIGRATE_DATABASE_URL=… npm run db:rls   # prod/Supabase (owner/postgres role)
 *
 * All three SQL files are idempotent (DO-guarded role + drop/recreate policies), so this
 * is safe to re-run on every deploy and after a DB restore — the point is that isolation
 * is one command, not a hand-run SQL-editor step, and can be gated in CI with the leak
 * test. Drizzle's own migrate chain stops at 0051 and later SQL is applied out-of-band,
 * so RLS lives here rather than in the drizzle journal.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_URL =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://sellerctrl:sellerctrl@localhost:5433/sellerctrl";

const FILES = ["00-appuser.sql", "01-policies.sql", "02-line-policies.sql", "03-triggers.sql"];

async function main() {
  const pool = new Pool({ connectionString: OWNER_URL });
  try {
    for (const f of FILES) {
      const sql = readFileSync(join(process.cwd(), "db", "rls", f), "utf8");
      process.stdout.write(`applying db/rls/${f} … `);
      await pool.query(sql);
      console.log("ok");
    }
    console.log("✅ RLS applied (appuser role + org + line policies). Idempotent — safe to re-run.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ apply-rls failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
