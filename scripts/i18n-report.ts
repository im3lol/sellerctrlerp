// Translation coverage. Two numbers that matter:
//   1. how many on-screen Arabic strings are wrapped in t() at all (the mechanical work)
//   2. how many of those wrapped strings have an English entry (the translation work)
// It also fails loudly on a t("…") key that is NOT in the dictionary and NOT Arabic —
// that is a typo or an accidental key, not a missing translation.
//
// Run: npx tsx --tsconfig tsconfig.script.json scripts/i18n-report.ts [--list]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EN } from "../lib/i18n/en";

const ROOTS = ["app", "components", "lib"];
const SKIP = new Set(["node_modules", ".next", "__tests__"]);
const AR = /[؀-ۿ]/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes("i18n")) out.push(p);
  }
  return out;
}

const wrapped = new Set<string>();
const raw = new Map<string, number>();     // untranslated Arabic literal → occurrences
const perArea = new Map<string, { wrapped: number; raw: number }>();

for (const f of ROOTS.flatMap((r) => files(r))) {
  const src = readFileSync(f, "utf8");
  const area = f.split(/[\/]/).slice(0, 2).join("/");
  const stat = perArea.get(area) ?? { wrapped: 0, raw: 0 };
  // Only a single-argument t("…") is a translation call; lib/erp/automation/model.ts has
  // its own local t(column, label) helper that must not be counted as one.
  // Decode the literal as JS would (\n, \") so the key matches the dictionary entry exactly.
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g)) { wrapped.add(JSON.parse(`"${m[1]}"`)); stat.wrapped++; }
  // Arabic literals that are NOT already inside a t("…")
  for (const m of src.matchAll(/"([^"\n]*[؀-ۿ][^"\n]*)"/g)) {
    const before = src.slice(Math.max(0, m.index! - 3), m.index!);
    if (/\bt\($/.test(before)) continue;
    raw.set(m[1], (raw.get(m[1]) ?? 0) + 1);
    stat.raw++;
  }
  perArea.set(area, stat);
}

const missing = [...wrapped].filter((k) => AR.test(k) && !EN[k]);
const bogus = [...wrapped].filter((k) => !AR.test(k) && !EN[k]);

console.log(`wrapped in t():      ${wrapped.size} unique strings`);
console.log(`translated:          ${wrapped.size - missing.length} (${Math.round(((wrapped.size - missing.length) / Math.max(1, wrapped.size)) * 100)}%)`);
console.log(`dictionary entries:  ${Object.keys(EN).length}`);
console.log(`still raw Arabic:    ${raw.size} unique (${[...raw.values()].reduce((a, b) => a + b, 0)} occurrences)`);
console.log("\nby area (raw Arabic literals left):");
for (const [area, s] of [...perArea.entries()].sort((a, b) => b[1].raw - a[1].raw).slice(0, 12)) {
  console.log(`  ${area.padEnd(22)} raw ${String(s.raw).padStart(5)}   wrapped ${s.wrapped}`);
}
if (missing.length) console.log(`\n⚠ wrapped but untranslated (${missing.length}):\n` + missing.slice(0, Number(process.env.I18N_MISSING ?? 20)).map((k) => `  ${k}`).join("\n"));
if (bogus.length) console.log(`\n✗ t() called with a non-Arabic key (likely a mistake):\n` + bogus.map((k) => `  ${k}`).join("\n"));
if (process.argv.includes("--list")) {
  console.log("\ntop untranslated strings by occurrences:");
  for (const [k, n] of [...raw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log(`  ${String(n).padStart(3)}  ${k}`);
}
process.exit(bogus.length ? 1 : 0);
