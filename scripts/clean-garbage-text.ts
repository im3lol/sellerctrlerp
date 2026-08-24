/**
 * Maintenance: find (and optionally fix) "garbage" text cells — values that are
 * ENTIRELY question marks / punctuation / whitespace (e.g. "??? ??????"), which
 * come from bad manual input, not the app (the save paths are UTF-8 clean). It
 * scans EVERY text/varchar column in the public schema via information_schema,
 * so new tables are covered automatically.
 *
 *   npx tsx scripts/clean-garbage-text.ts           # dry run — just report
 *   npx tsx scripts/clean-garbage-text.ts --fix      # replace with a placeholder
 *
 * Env:
 *   DATABASE_URL             connection (defaults to local). For PROD point this
 *                            at the OWNER/direct connection — an RLS-scoped
 *                            appuser role only sees its own org's rows.
 *   GARBAGE_REPLACEMENT      placeholder written by --fix (default "غير محدّد")
 *   DB_SSL_INSECURE=1        no-verify TLS for a self-signed certificate
 *
 * ponytail: one neutral placeholder for every column — the cell was meaningless
 * anyway; a per-column label map isn't worth it for a rare manual cleanup.
 */
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL ?? "postgres://sellerctrl:sellerctrl@localhost:5433/sellerctrl";
const replacement = process.env.GARBAGE_REPLACEMENT ?? "غير محدّد";
const apply = process.argv.includes("--fix");

// A value is garbage only if it CONTAINS a '?' AND is made up solely of
// question marks, punctuation and whitespace — so a legit "متى؟" is never touched.
// Cast to ::text so exotic types information_schema still labels text/varchar
// (citext, domains) can't break the regex operator.
const GARBAGE = (col: string) => `(${col})::text ~ '\\?' AND (${col})::text ~ '^[[:space:][:punct:]?]+$'`;

// Mirror lib/db's TLS decision so this connects the same way as the app.
const isLocal = /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(connectionString);
const ssl = isLocal ? undefined : process.env.DB_SSL_INSECURE === "1" ? { rejectUnauthorized: false } : { rejectUnauthorized: true };

async function main() {
  const pool = new Pool({ connectionString, ssl, max: 1 });
  try {
    const cols = (await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('text','character varying')`,
    )).rows;

    let total = 0;
    let fixed = 0;
    for (const { table_name, column_name } of cols) {
      const t = `"${table_name}"`, c = `"${column_name}"`;
      const n = Number((await pool.query<{ n: string }>(`SELECT count(*) n FROM ${t} WHERE ${GARBAGE(c)}`)).rows[0].n);
      if (n === 0) continue;
      total += n;
      console.log(`  ${apply ? "fixing" : "found"}  ${table_name}.${column_name} — ${n}`);
      if (apply) {
        const r = await pool.query(`UPDATE ${t} SET ${c} = $1 WHERE ${GARBAGE(c)}`, [replacement]);
        fixed += r.rowCount ?? 0;
      }
    }

    if (total === 0) console.log("✅ no garbage text cells found");
    else if (apply) console.log(`\n✅ replaced ${fixed} cell(s) with "${replacement}"`);
    else console.log(`\n⚠️  ${total} garbage cell(s) — re-run with --fix to replace them with "${replacement}"`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
