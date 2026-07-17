/**
 * One-off codemod: wrap ERP page bodies in the RLS scope via loadErpPage.
 *
 *   const { orgId, can } = await requireErpModule("sales.view");   →  return loadErpPage("sales.view", async ({ orgId, can }) => {
 *   <body>                                                              <body, reindented +2>
 *                                                                    });
 *
 * moduleOverride (2nd arg of requireErpModule) moves to loadErpPage's 3rd param.
 * The guard line is replaced (requireErpModule runs first INSIDE loadErpPage, then
 * the scope wraps the handler) so the import token is swapped to loadErpPage.
 *
 *   npx tsx scripts/rls-wrap-pages.ts <file.tsx...>
 */
import ts from "typescript";
import fs from "fs";

function isReqGuard(s: ts.Statement, sf: ts.SourceFile): { call: ts.CallExpression; binding: string } | null {
  let init: ts.Expression | undefined, binding = "";
  if (ts.isVariableStatement(s)) {
    const d = s.declarationList.declarations[0];
    if (!d || !d.initializer) return null;
    init = d.initializer; binding = d.name.getText(sf);
  } else if (ts.isExpressionStatement(s)) {
    init = s.expression;
  } else return null;
  if (!init || !ts.isAwaitExpression(init) || !ts.isCallExpression(init.expression)) return null;
  const c = init.expression;
  if (!ts.isIdentifier(c.expression) || c.expression.text !== "requireErpModule") return null;
  return { call: c, binding };
}

function wrapFile(file: string): boolean {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: { start: number; end: number; text: string }[] = [];

  function fnBody(node: ts.Node): ts.Block | undefined {
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.body && ts.isBlock(node.body)) return node.body;
    return undefined;
  }
  function visit(node: ts.Node) {
    const body = fnBody(node);
    if (body) {
      const st = body.statements;
      for (let i = 0; i < st.length; i++) {
        const g = isReqGuard(st[i], sf);
        if (!g) continue;
        if (i + 1 > st.length - 1) continue; // guard is last stmt (no body) — leave
        const arg0 = g.call.arguments[0]?.getText(sf) ?? "";
        const arg1 = g.call.arguments[1]?.getText(sf);
        const param = g.binding || "";
        const first = st[i + 1], last = st[st.length - 1];
        const regionStart = st[i].getStart(sf);           // replace from the guard line itself
        const regionEnd = last.getEnd();
        const rest = src.slice(first.getStart(sf), regionEnd).replace(/(\r?\n)(?=[^\r\n])/g, "$1  ");
        const tail = arg1 ? `, ${arg1}` : "";
        edits.push({ start: regionStart, end: regionEnd, text: `return loadErpPage(${arg0}, async (${param}) => {\n    ${rest}\n  }${tail});` });
        break; // one guard per function
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) return false;

  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // Import: swap requireErpModule → loadErpPage in the org import (guard call is gone).
  if (/\brequireErpModule\b/.test(out.replace(/import[^\n]*\n/g, ""))) {
    // still referenced elsewhere — add loadErpPage alongside
    out = out.replace(/(import\s*\{)([^}]*)\}(\s*from\s*"@\/lib\/erp\/org")/, (_m, a, names, b) => `${a}${names}, loadErpPage }${b}`);
  } else {
    out = out.replace(/(import\s*\{[^}]*)\brequireErpModule\b([^}]*\}\s*from\s*"@\/lib\/erp\/org")/, `$1loadErpPage$2`);
  }
  fs.writeFileSync(file, out);
  console.log(`wrapped ${file}`);
  return true;
}

let w = 0, s = 0;
for (const f of process.argv.slice(2)) { if (wrapFile(f)) w++; else { s++; console.log(`skip ${f}`); } }
console.log(`\n${w} wrapped, ${s} skipped`);
