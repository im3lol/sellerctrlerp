// Convert hard-coded Arabic-Indic digit literals → Latin across source.
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["app", "components", "lib"];
const map = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٬": ",", "٫": ".",
};
const re = /[٠-٩۰-۹٬٫]/g;
let changed = 0;

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) {
      const before = readFileSync(p, "utf8");
      const after = before.replace(re, (c) => map[c] ?? c);
      if (after !== before) { writeFileSync(p, after); changed++; console.log("fixed", p); }
    }
  }
}
for (const r of roots) walk(r);
console.log(`\n${changed} file(s) updated`);
