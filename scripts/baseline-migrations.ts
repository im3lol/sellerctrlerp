/**
 * Stamp an EXISTING database as already-migrated, so `db:migrate` picks up from the end
 * of the journal instead of replaying 0000 (which would fail — the early drizzle-generated
 * migrations are plain CREATE TABLE, no IF NOT EXISTS).
 *
 *   npm run db:baseline                     # local Docker (owner on :5433)
 *   MIGRATE_DATABASE_URL=… npm run db:baseline
 *
 * Needed once per database that was built by `drizzle-kit push` while the journal was
 * stalled at 0051 — those have an EMPTY drizzle.__drizzle_migrations even though the
 * schema is complete. A freshly `db:migrate`d database never needs this.
 *
 * Refuses to run if any migration is already recorded, so it can't double-stamp; and
 * refuses on an empty database, where the right answer is `db:migrate`.
 */
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_URL =
  process.env.MIGRATE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://sellerctrl:sellerctrl@localhost:5433/sellerctrl";

type Entry = { tag: string; when: number };
const dir = join(process.cwd(), "db", "migrations");
const journal: { entries: Entry[] } = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));

async function main() {
  const pool = new Pool({ connectionString: OWNER_URL });
  try {
    // Same shape drizzle's migrator creates, so stamping first is safe either way.
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

    const { rows: [{ count }] } = await pool.query<{ count: string }>(
      `select count(*)::text as count from drizzle.__drizzle_migrations`);
    if (count !== "0") {
      console.log(`ℹ️  already stamped (${count} migrations recorded) — nothing to do.`);
      return;
    }
    const { rows: [{ tables }] } = await pool.query<{ tables: string }>(
      `select count(*)::text as tables from information_schema.tables where table_schema='public'`);
    if (tables === "0") throw new Error("database is empty — run `npm run db:migrate`, not baseline");

    for (const e of journal.entries) {
      const hash = createHash("sha256").update(readFileSync(join(dir, `${e.tag}.sql`))).digest("hex");
      await pool.query(`insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`, [hash, e.when]);
    }
    console.log(`✅ stamped ${journal.entries.length} migrations as applied (schema untouched).`);
    console.log("   `npm run db:migrate` now applies only what comes after them.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ baseline failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
