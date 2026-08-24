import { sql } from "drizzle-orm";
import { db } from "@/lib/db"; // owner connection — reads the catalogs

// Coverage guard: EVERY table carrying organization_id must have FORCE ROW LEVEL
// SECURITY + an org_isolation policy. RLS is defined in two places (db/rls/*.sql for
// the core + inline in each feature table's creation migration), so a new table added
// without RLS in either place would silently leak across tenants. This enumerates the
// live schema so coverage can't regress unnoticed — wire it into CI against a migrated
// DB. Exit 1 on any uncovered table.
async function main() {
  const rows = (await db.execute<{ relname: string; forced: boolean; has_policy: boolean }>(sql`
    SELECT c.relname,
           c.relforcerowsecurity AS forced,
           EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'org_isolation') AS has_policy
    FROM information_schema.columns col
    JOIN pg_class c ON c.relname = col.table_name AND c.relkind = 'r'
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE col.table_schema = 'public' AND col.column_name = 'organization_id'
    ORDER BY c.relname`)).rows;

  const uncovered = rows.filter((r) => !r.forced || !r.has_policy);
  console.log(`RLS coverage: ${rows.length - uncovered.length}/${rows.length} org-scoped tables forced + policied`);
  for (const r of uncovered) {
    console.log(`  ❌ ${r.relname} — ${!r.forced ? "RLS not FORCED" : ""}${!r.forced && !r.has_policy ? " + " : ""}${!r.has_policy ? "no org_isolation policy" : ""}`);
  }
  if (uncovered.length) { console.error(`❌ ${uncovered.length} org-scoped table(s) without enforced RLS — add ENABLE/FORCE + org_isolation policy.`); process.exit(1); }
  console.log("✅ every org-scoped table has enforced tenant isolation");
  process.exit(0);
}

main().catch((e) => { console.error("chk-rls-coverage failed:", e instanceof Error ? e.message : e); process.exit(1); });
