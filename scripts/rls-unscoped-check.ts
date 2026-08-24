/**
 * Regression guard for the RLS rollout: fail if any app handler reads/writes a
 * POLICIED table without opening an RLS scope. Every query must run inside one of
 * loadErpPage / withOrgScope / withPlatformScope / runAsErp / withErpAction, else
 * at the appuser cutover it silently returns 0 rows (reads) or is blocked (writes).
 *
 * Heuristic: an ENTRY-POINT file (app/ routes+pages+actions, and lib/queue/ worker
 * handlers — the two places that must OPEN a scope) that imports `db`, imports a
 * non-global table from @/db/schema, and contains none of the scope wrappers is
 * flagged. Global tables (no org, no policy) are exempt. Run in CI.
 *
 * Limitation (known): this is file-level — a file that opens a scope for ONE function
 * passes even if another function in it reads unscoped (that's how the workerErpContext
 * regression hid behind withPlatformScope). lib/erp/ helpers are intentionally NOT
 * scanned (they run inside a caller's scope); a per-function/AST guard is the real fix.
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
// app/ = pages+routes+actions; lib/queue/ = the BullMQ worker handlers (entry points
// with no request scope). Both must open their own scope. lib/erp helpers are excluded.
for (const f of [...walk("app"), ...walk(path.join("lib", "queue"))]) {
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
