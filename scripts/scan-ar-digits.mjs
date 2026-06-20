// Scan source for hard-coded Arabic-Indic digit literals (must be Latin).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["app", "components", "lib"];
const re = /[٠-٩۰-۹]/;
const hits = [];

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((ln, i) => {
        if (re.test(ln)) hits.push(`${p}:${i + 1}: ${ln.trim().slice(0, 90)}`);
      });
    }
  }
}
for (const r of roots) walk(r);
console.log(hits.length ? hits.join("\n") : "NO Arabic-Indic digit literals found ✓");
console.log(`\n${hits.length} line(s)`);
