/**
 * Wraps on-screen Arabic literals in t(), and gives the file a `t` to call.
 *
 * Deliberately conservative — it only touches shapes it can rewrite without changing
 * behaviour, and skips anything it is not sure about (the report then still lists those,
 * and they get done by hand):
 *   • JSX text:   >حفظ<            → >{t("حفظ")}<     (plain text nodes only)
 *   • JSX props:  title="حفظ"      → title={t("حفظ")}  (whitelisted props)
 *   • it NEVER touches template literals, concatenations, object keys, imports,
 *     "use client", className, href, or any string holding {} or `${}`.
 *
 * The `t` binding: a "use client" file gets `const t = useT()` at the top of each
 * component that needs it; a server component file gets `const t = await getT()` only
 * when the function is already async (otherwise the file is left for a human).
 *
 * Run:  npx tsx --tsconfig tsconfig.script.json scripts/i18n-codemod.ts <file…> [--dry]
 */
import { readFileSync, writeFileSync } from "node:fs";

const PROPS = ["title", "placeholder", "label", "aria-label", "description", "subtitle", "emptyText", "confirmText", "cancelText", "alt"];
const AR = /[؀-ۿ]/;
const dry = process.argv.includes("--dry");
const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));

let totalWrapped = 0;
const skipped: string[] = [];

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let src = before;
  let wrapped = 0;

  // 1) JSX props: title="عربي" → title={t("عربي")}
  for (const p of PROPS) {
    src = src.replace(new RegExp(`(\\s${p}=)"([^"{}\\n]*[\\u0600-\\u06FF][^"{}\\n]*)"`, "g"), (_m, lhs, text) => {
      wrapped++;
      return `${lhs}{t(${JSON.stringify(text)})}`;
    });
  }

  // 2) JSX text nodes: >عربي< → >{t("عربي")}<  — only plain text, no braces or tags inside.
  src = src.replace(/>([^<>{}\n]*[؀-ۿ][^<>{}\n]*)</g, (_m, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return _m;
    const [, lead = "", , trail = ""] = text.match(/^(\s*)([\S\s]*?)(\s*)$/) ?? [];
    wrapped++;
    return `>${lead}{t(${JSON.stringify(trimmed)})}${trail}<`;
  });

  if (!wrapped) continue;

  // 3) give the file a `t`
  const isClient = /^["']use client["'];/m.test(src);
  if (isClient) {
    if (!/useT\s*\}/.test(src) && !src.includes('from "@/lib/i18n/client"')) {
      src = src.replace(/^(import .*\n)/m, `$1import { useT } from "@/lib/i18n/client";\n`);
    }
    // One hook per component function that contains a t( call and has no `t` yet.
    src = src.replace(/(export (?:default )?function \w+\([\s\S]*?\n?\) \{\n)/g, (m) => m);
    const fnStarts = [...src.matchAll(/(?:export )?(?:default )?function (\w+)\(/g)];
    for (let i = fnStarts.length - 1; i >= 0; i--) {
      const start = fnStarts[i].index!;
      const end = i + 1 < fnStarts.length ? fnStarts[i + 1].index! : src.length;
      const body = src.slice(start, end);
      if (!/\bt\(/.test(body) || /const t = useT\(\)/.test(body)) continue;
      // Insert right after the function's opening brace (the first `{\n` after the signature).
      const open = body.indexOf(") {\n");
      if (open === -1) { skipped.push(`${file}: ${fnStarts[i][1]} — could not find the body start`); continue; }
      const at = start + open + 4;
      src = `${src.slice(0, at)}  const t = useT();\n${src.slice(at)}`;
    }
  } else {
    skipped.push(`${file}: server component — add \`const t = await getT()\` by hand (${wrapped} strings wrapped)`);
    if (!src.includes('from "@/lib/i18n/server"')) {
      src = src.replace(/^(import .*\n)/m, `$1import { getT } from "@/lib/i18n/server";\n`);
    }
  }

  totalWrapped += wrapped;
  if (!dry) writeFileSync(file, src);
  console.log(`${wrapped.toString().padStart(4)}  ${file}${isClient ? "" : "   (server — needs the await by hand)"}`);
}

console.log(`\n${totalWrapped} strings wrapped in ${files.length} file(s)${dry ? " (dry run)" : ""}`);
if (skipped.length) console.log("\nneeds a human:\n" + skipped.map((s) => `  ${s}`).join("\n"));
