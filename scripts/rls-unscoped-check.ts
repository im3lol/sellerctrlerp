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
 * scanned EXCEPT those an unscoped /api/v1 route imports directly (second pass below).
 */
import fs from "fs";
import path from "path";

const GLOBALS = new Set(["organizations", "users", "plans", "discountCoupons", "academyLessons", "changelogEntries", "passwordHistory"]);
const WRAPPERS = /(loadErpPage|withOrgScope|withPlatformScope|runAsErp|withErpAction)\s*\(/;

/** Comments are stripped before the wrapper test — a file that only MENTIONS withOrgScope
 *  in a doc comment used to pass while calling nothing. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
  if (WRAPPERS.test(code(src))) continue;
  const m = src.match(/import \{([^}]*)\} from "@\/db\/schema"/);
  if (!m) continue;
  const policied = m[1].split(",").map((s) => s.replace(/[^a-zA-Z]/g, "")).filter((t) => t && !GLOBALS.has(t));
  if (policied.length) offenders.push(`${f.replace(/\\/g, "/")}  →  ${policied.join(", ")}`);
}

// Second pass — the blind spot that let /api/v1 ship unscoped: those routes hold no
// scope of their own, they hand orgId straight to a lib/erp helper. So every lib/erp
// module an /api/v1 route imports must open the scope ITSELF (the mobile-lists.ts
// `scoped()` pattern). Only these directly-imported modules are checked; helpers deeper
// in the chain run inside whatever their caller opened.
// A route that opens its own scope (runAsErp) covers whatever it calls, so only routes
// with NO wrapper are inspected — and then the helper must open the scope itself.
for (const route of walk(path.join("app", "api", "v1"))) {
  const routeSrc = fs.readFileSync(route, "utf8");
  if (WRAPPERS.test(code(routeSrc))) continue;
  for (const m of routeSrc.matchAll(/from "@\/(lib\/erp\/[\w-]+)"/g)) {
    const f = `${m[1]}.ts`;
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (!/from "@\/lib\/db"/.test(src)) continue;
    if (WRAPPERS.test(code(src))) continue;
    // Any db use counts here — the route opened no scope, so nothing else will. A helper
    // that reaches its tables through db.execute, or through another module, still runs
    // on the bare pool. Table names are only for the message.
    const tables = src.match(/import \{([^}]*)\} from "@\/db\/schema"/);
    const policied = tables ? tables[1].split(",").map((s) => s.replace(/[^a-zA-Z]/g, "")).filter((t) => t && !GLOBALS.has(t)) : [];
    offenders.push(`${f}  →  called with no scope from ${route.replace(/\\/g, "/")} (${policied.join(", ") || "db queries"})`);
  }
}

if (offenders.length) {
  console.error(`❌ ${offenders.length} handler(s) read policied tables with NO RLS scope:\n` + offenders.map((o) => "  " + o).join("\n"));
  process.exit(1);
}
console.log("✅ no unscoped policied reads");
