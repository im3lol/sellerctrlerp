/**
 * Regression guard for the RLS rollout: fail if any app handler reads/writes a
 * POLICIED table without opening an RLS scope. Every query must run inside one of
 * loadErpPage / withOrgScope / withPlatformScope / runAsErp / withErpAction, else
 * at the appuser cutover it silently returns 0 rows (reads) or is blocked (writes).
 *
 * Heuristic: an app/ file that imports `db`, imports a non-global table from
 * @/db/schema, and contains none of the scope wrappers is flagged. Global tables
 * (no org, no policy) are exempt. Run in CI: `npx tsx scripts/rls-unscoped-check.ts`.
 */
import fs from "fs";
import path from "path";

const GLOBALS = new Set(["organizations", "users", "plans", "discountCoupons", "academyLessons", "changelogEntries", "passwordHistory", "attendance"]);
const WRAPPERS = /loadErpPage|withOrgScope|withPlatformScope|runAsErp|withErpAction/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders: string[] = [];
for (const f of walk("app")) {
  const src = fs.readFileSync(f, "utf8");
  if (!/from "@\/lib\/db"/.test(src)) continue;
  if (WRAPPERS.test(src)) continue;
  const m = src.match(/import \{([^}]*)\} from "@\/db\/schema"/);
  if (!m) continue;
  const policied = m[1].split(",").map((s) => s.replace(/[^a-zA-Z]/g, "")).filter((t) => t && !GLOBALS.has(t));
  if (policied.length) offenders.push(`${f.replace(/\\/g, "/")}  →  ${policied.join(", ")}`);
}

if (offenders.length) {
  console.error(`❌ ${offenders.length} handler(s) read policied tables with NO RLS scope:\n` + offenders.map((o) => "  " + o).join("\n"));
  process.exit(1);
}
console.log("✅ no unscoped policied reads");
