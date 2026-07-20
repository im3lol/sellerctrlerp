/**
 * One-off codemod: wrap platform (admin) surfaces in withPlatformScope so their
 * cross-org reads/writes bypass RLS. Admin actions are gated by
 * requireCapability("employee.manage") (system_admin-only); admin pages by the
 * (admin) layout's system_admin redirect.
 *
 *   ACTIONS:  await requireCapability("employee.manage");   →  await requireCapability(...);
 *             <body>                                            return withPlatformScope(async () => { <body> });
 *   PAGES  :  export default async function P() { <body> }   →  ...{ return withPlatformScope(async () => { <body> }); }
 *
 *   npx tsx scripts/rls-wrap-admin.ts <file...>
 */
import ts from "typescript";
import fs from "fs";

function wrapFile(file: string): boolean {
  const src = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const edits: { start: number; end: number; text: string }[] = [];

  function fnBody(node: ts.Node): ts.Block | undefined {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) return node.body;
    return undefined;
  }
  const isReqCap = (s: ts.Statement) => {
    // bare `await requireCapability(...)` or `const x = await requireCapability(...)`
    let ae: ts.Expression | undefined;
    if (ts.isExpressionStatement(s)) ae = s.expression;
    else if (ts.isVariableStatement(s)) ae = s.declarationList.declarations[0]?.initializer;
    return !!ae && ts.isAwaitExpression(ae) && ts.isCallExpression(ae.expression)
      && ts.isIdentifier(ae.expression.expression) && ae.expression.expression.text === "requireCapability";
  };

  function visit(node: ts.Node) {
    const body = fnBody(node);
    if (body) {
      const st = body.statements;
      const gi = st.findIndex(isReqCap);
      // Action: wrap after the requireCapability guard. Page: no guard → wrap whole body.
      const startIdx = gi >= 0 ? gi + 1 : 0;
      const usesDb = /\bdb\b/.test(body.getText(sf));
      const alreadyWrapped = st[startIdx] && /^return withPlatformScope\(/.test(st[startIdx].getText(sf));
      if (st.length > startIdx && usesDb && !alreadyWrapped && (gi >= 0 || node.parent && ts.isExportAssignment(node.parent) || (ts.isFunctionDeclaration(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)))) {
        const first = st[startIdx], last = st[st.length - 1];
        const regionStart = first.getStart(sf), regionEnd = last.getEnd();
        const rest = src.slice(regionStart, regionEnd).replace(/(\r?\n)(?=[^\r\n])/g, "$1  ");
        edits.push({ start: regionStart, end: regionEnd, text: `return withPlatformScope(async () => {\n    ${rest}\n  });` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) return false;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!/from "@\/lib\/db-scope"/.test(out)) {
    const nl = out.includes("\r\n") ? "\r\n" : "\n";
    const lines = out.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^import\b/.test(l));
    lines.splice(idx < 0 ? 0 : idx, 0, `import { withPlatformScope } from "@/lib/db-scope";`);
    out = lines.join(nl);
  }
  fs.writeFileSync(file, out);
  console.log(`wrapped ${file}  (${edits.length})`);
  return true;
}

let w = 0, s = 0;
for (const f of process.argv.slice(2)) { if (wrapFile(f)) w++; else { s++; console.log(`skip ${f}`); } }
console.log(`\n${w} wrapped, ${s} skipped`);
