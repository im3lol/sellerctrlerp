/**
 * Apply Row-Level Security reproducibly: the appuser role + tenant-isolation policies
 * on every org + line table. Run as the DB OWNER (migrations role), which is why this
 * is separate from the app's runtime connection.
 *
 *   npm run db:rls                    # local Docker (owner on :5433)
 *   MIGRATE_DATABASE_URL=… npm run db:rls   # prod/Supabase (owner/postgres role)
 *   tsx scripts/apply-rls.ts 00-appuser.sql # one file — used by db:migrate, see below
 *
 * All four SQL files are idempotent (DO-guarded role + drop/recreate policies), so this
 * is safe to re-run on every deploy and after a DB restore — the point is that isolation
 * is one command, not a hand-run SQL-editor step, and can be gated in CI with the leak
 * test. Policies and triggers can't live in the drizzle chain: they must be re-applied
 * after every schema change, and they reference tables the chain is still building.
 *
 * The role, though, is a PREREQUISITE of the chain — migrations from 0055 on GRANT to
 * appuser — so `db:migrate` runs 00-appuser.sql first via the file argument above.
 * Hence the argument, rather than a second copy of the CREATE ROLE inside a migration.
 */
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_URL =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://sellerctrl:sellerctrl@localhost:5433/sellerctrl";

const ALL = ["00-appuser.sql", "01-policies.sql", "02-line-policies.sql", "03-triggers.sql"];
const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
for (const f of FILES) if (!ALL.includes(f)) throw new Error(`unknown RLS file: ${f} (expected one of ${ALL.join(", ")})`);

async function main() {
  const pool = new Pool({ connectionString: OWNER_URL });
  try {
    for (const f of FILES) {
      const sql = readFileSync(join(process.cwd(), "db", "rls", f), "utf8");
      process.stdout.write(`applying db/rls/${f} … `);
      await pool.query(sql);
      console.log("ok");
    }
    console.log(`✅ applied ${FILES.length === ALL.length ? "RLS (appuser role + org + line policies)" : FILES.join(", ")}. Idempotent — safe to re-run.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ apply-rls failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
