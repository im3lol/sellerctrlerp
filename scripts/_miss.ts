import { readFileSync } from "fs";
import { EN as en } from "@/lib/i18n/en";
const out = new Set<string>();
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
    let k: string; try { k = JSON.parse(`"${m[1]}"`); } catch { continue; }
    if (/[؀-ۿ]/.test(k) && !(k in en)) out.add(k);
  }
}
console.log(JSON.stringify([...out], null, 0));
