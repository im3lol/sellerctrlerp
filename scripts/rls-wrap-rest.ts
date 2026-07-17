/**
 * One-off codemod: wrap the REST of the handler families the first sweep missed
 * (it only covered `authorizeErp` actions + `requireErpModule` pages). Three guard
 * shapes, each wrapping everything after the guard so the body runs RLS-scoped:
 *
 *  A. const { orgId } = await requireErpModule("x");   → + return withOrgScope(orgId, false, async () => { … });
 *  B. const orgId = await resolveOrgByApiKey(...);      → (after the !orgId guard) return withOrgScope(orgId, false, async () => { … });
 *     if (!orgId) return ...;
 *  C. const auth = await authorizeApi(req, "x");        → return runAsErp(auth, async () => { … });
 *     if (isApiError(auth)) return auth;
 *
 *   npx tsx scripts/rls-wrap-rest.ts <file...>
 */
import ts from "typescript";
import fs from "fs";

type Match = { anchorEndIdx: number; open: string; needOrgScope: boolean; needRunAsErp: boolean };

function detect(st: ReadonlyArray<ts.Statement>, sf: ts.SourceFile, i: number): Match | null {
  const s = st[i];
  if (!ts.isVariableStatement(s)) return null;
  const d = s.declarationList.declarations[0];
  if (!d || !d.initializer || !ts.isAwaitExpression(d.initializer) || !ts.isCallExpression(d.initializer.expression)) return null;
  const callee = d.initializer.expression.expression;
  const fn = ts.isIdentifier(callee) ? callee.text : "";

  // A. requireErpModule → destructures { orgId }
  if (fn === "requireErpModule" && ts.isObjectBindingPattern(d.name)) {
    const hasOrg = d.name.elements.some((e) => ts.isIdentifier(e.name) && e.name.text === "orgId");
    if (!hasOrg) return null;
    return { anchorEndIdx: i, open: `return withOrgScope(orgId, false, async () => {`, needOrgScope: true, needRunAsErp: false };
  }
  // B. resolveOrgByApiKey → `const orgId = …` then `if (!orgId) return …;`
  if (fn === "resolveOrgByApiKey" && ts.isIdentifier(d.name) && d.name.text === "orgId") {
    const g = st[i + 1];
    if (g && ts.isIfStatement(g)) return { anchorEndIdx: i + 1, open: `return withOrgScope(orgId, false, async () => {`, needOrgScope: true, needRunAsErp: false };
  }
  // C. authorizeApi → `const auth = …` then `if (isApiError(auth)) return auth;`
  if (fn === "authorizeApi" && ts.isIdentifier(d.name) && d.name.text === "auth") {
    const g = st[i + 1];
    if (g && ts.isIfStatement(g)) return { anchorEndIdx: i + 1, open: `return runAsErp(auth, async () => {`, needOrgScope: false, needRunAsErp: true };
  }
  return null;
}

function wrapFile(file: string): boolean {
  const src = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const edits: { start: number; end: number; text: string }[] = [];
  let orgScope = false, runAs = false;

  function fnBody(n: ts.Node): ts.Block | undefined {
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body)) return n.body;
    return undefined;
  }
  function visit(node: ts.Node) {
    const body = fnBody(node);
    if (body) {
      const st = body.statements;
      for (let i = 0; i < st.length; i++) {
        const m = detect(st, sf, i);
        if (!m) continue;
        if (m.anchorEndIdx + 1 > st.length - 1) break;
        const first = st[m.anchorEndIdx + 1], last = st[st.length - 1];
        if (/^return (withOrgScope|runAsErp)\(/.test(first.getText(sf))) break; // already wrapped
        const rs = first.getStart(sf), re = last.getEnd();
        const rest = src.slice(rs, re).replace(/(\r?\n)(?=[^\r\n])/g, "$1  ");
        edits.push({ start: rs, end: re, text: `${m.open}\n    ${rest}\n  });` });
        if (m.needOrgScope) orgScope = true;
        if (m.needRunAsErp) runAs = true;
        break; // one wrap per function
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!edits.length) return false;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const nl = out.includes("\r\n") ? "\r\n" : "\n";
  const addImport = (spec: string) => {
    if (out.includes(spec)) return;
    const lines = out.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^import\b/.test(l));
    lines.splice(idx < 0 ? 0 : idx, 0, spec);
    out = lines.join(nl);
  };
  if (orgScope) addImport(`import { withOrgScope } from "@/lib/db-scope";`);
  if (runAs && !/\brunAsErp\b/.test(src.split(/\r?\n/).filter((l) => /^import/.test(l)).join("\n")))
    addImport(`import { runAsErp } from "@/lib/erp/api-auth";`);
  fs.writeFileSync(file, out);
  console.log(`wrapped ${file}`);
  return true;
}

let w = 0, s = 0;
for (const f of process.argv.slice(2)) { if (wrapFile(f)) w++; else { s++; console.log(`skip ${f}`); } }
console.log(`\n${w} wrapped, ${s} skipped`);
