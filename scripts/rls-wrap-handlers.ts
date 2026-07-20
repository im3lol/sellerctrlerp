/**
 * One-off codemod: wrap the body of tenant server actions / ERP pages in the RLS
 * scope, so every query runs under the org's `set_config`. Transforms the exact,
 * regular guard shape only; anything else is reported as "skip" for manual review.
 *
 *   const auth = await authorizeErp("x");        →  const auth = await authorizeErp("x");
 *   if ("error" in auth) return auth;               if ("error" in auth) return auth;
 *   <body>                                          return withOrgScope(auth.orgId, false, async () => {
 *                                                     <body, reindented +2>
 *                                                   });
 *
 * Pages (requireErpModule):
 *   const { orgId, can } = await requireErpModule("x");   →  ... requireErpModule("x");
 *   <body>                                                   return withOrgScope(ctx0.orgId, false, ...)  (see note)
 *
 * We only do the ACTION shape here (authorizeErp + auth). Pages are handled with a
 * separate, simpler pass because their guard binds a destructured ctx.
 *
 *   npx tsx scripts/rls-wrap-handlers.ts <file...>
 */
import ts from "typescript";
import fs from "fs";

const GUARD = 'if ("error" in auth) return auth;';

function wrapFile(file: string): "wrapped" | "skip" | "partial" {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits: { start: number; end: number; text: string }[] = [];
  let matched = 0, skippedFns = 0;

  function fnBody(node: ts.Node): ts.Block | undefined {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) && node.body && ts.isBlock(node.body)) return node.body;
    return undefined;
  }

  const skipNames = new Set((process.env.SKIP_FNS ?? "").split(",").filter(Boolean));

  function visit(node: ts.Node) {
    // Named functions on the skip list (e.g. no-db upload actions) are left alone.
    if (ts.isFunctionDeclaration(node) && node.name && skipNames.has(node.name.text)) return;
    const body = fnBody(node);
    if (body) {
      const st = body.statements;
      for (let i = 0; i < st.length - 1; i++) {
        const s = st[i];
        if (!ts.isVariableStatement(s)) continue;
        const d = s.declarationList.declarations[0];
        const isAuth = d && ts.isIdentifier(d.name) && d.name.text === "auth" && d.initializer && ts.isAwaitExpression(d.initializer)
          && ts.isCallExpression(d.initializer.expression) && ts.isIdentifier(d.initializer.expression.expression)
          && d.initializer.expression.expression.text === "authorizeErp";
        if (!isAuth) continue;
        // Guard: `if ("error" in auth) return <anything>;` — any early-return shape
        // ([], null, { ok:false, error:auth.error }, auth). No else-branch.
        const guard = st[i + 1];
        if (!ts.isIfStatement(guard) || guard.elseStatement) { skippedFns++; continue; }
        if (guard.expression.getText(sf).replace(/\s+/g, " ").trim() !== '"error" in auth') { skippedFns++; continue; }
        if (i + 2 > st.length - 1) { skippedFns++; continue; } // nothing after guard
        const first = st[i + 2], last = st[st.length - 1];
        // Idempotent: already wrapped → leave it (avoids double-wrap on re-runs).
        if (/^return withOrgScope\(auth\.orgId,/.test(first.getText(sf))) continue;
        const regionStart = first.getStart(sf), regionEnd = last.getEnd();
        const region = src.slice(regionStart, regionEnd).replace(/(\r?\n)(?=[^\r\n])/g, "$1  "); // +2 indent, skip blank lines (CRLF-safe)
        edits.push({ start: regionStart, end: regionEnd, text: `return withOrgScope(auth.orgId, false, async () => {\n    ${region}\n  });` });
        matched++;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (!matched) return "skip";
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!/from "@\/lib\/db-scope"/.test(out)) {
    const nl = out.includes("\r\n") ? "\r\n" : "\n";
    const lines = out.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^import\b/.test(l));
    lines.splice(idx < 0 ? 0 : idx, 0, `import { withOrgScope } from "@/lib/db-scope";`);
    out = lines.join(nl);
  }
  fs.writeFileSync(file, out);
  console.log(`wrapped ${file}  (${matched} fn${skippedFns ? `, ${skippedFns} skipped` : ""})`);
  return skippedFns ? "partial" : "wrapped";
}

const files = process.argv.slice(2);
let w = 0, s = 0, p = 0;
for (const f of files) { const r = wrapFile(f); if (r === "wrapped") w++; else if (r === "partial") p++; else { s++; console.log(`skip ${f}`); } }
console.log(`\n${w} wrapped, ${p} partial, ${s} skipped`);
