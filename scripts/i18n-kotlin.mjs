// Kotlin string inventory / migration. Ignores comments and preserves interpolation.
// node scripts/i18n-kotlin.mjs [--write-legacy]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function kotlinStrings(source) {
  const strings = [];
  const commentEnd = (at) => {
    if (source.startsWith("//", at)) return source.indexOf("\n", at) < 0 ? source.length : source.indexOf("\n", at);
    if (!source.startsWith("/*", at)) return at;
    let depth = 1, i = at + 2;
    while (i < source.length && depth) {
      if (source.startsWith("/*", i)) { depth++; i += 2; }
      else if (source.startsWith("*/", i)) { depth--; i += 2; }
      else i++;
    }
    return i;
  };
  const quoted = (start) => {
    if (source.startsWith('"""', start)) {
      const end = source.indexOf('"""', start + 3);
      return { end: end < 0 ? source.length : end + 3, text: source.slice(start + 3, end), raw: true };
    }
    let i = start + 1, text = "", slot = 0;
    while (i < source.length) {
      if (source[i] === "\\") {
        const escapes = { n: "\n", r: "\r", t: "\t", b: "\b", '"': '"', "\\": "\\", $: "$", "'": "'" };
        const code = source[i + 1];
        if (code === "u" && /^[0-9a-f]{4}$/i.test(source.slice(i + 2, i + 6))) {
          text += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16)); i += 6;
        } else { text += escapes[code] ?? source.slice(i, i + 2); i += 2; }
      }
      else if (source[i] === '"') return { end: i + 1, text, raw: false };
      else if (source.startsWith("${", i)) {
        let depth = 1; i += 2;
        while (i < source.length && depth) {
          const end = commentEnd(i);
          if (end !== i) i = end;
          else if (source[i] === '"') i = quoted(i).end;
          else { if (source[i] === "{") depth++; if (source[i] === "}") depth--; i++; }
        }
        text += `{${slot++}}`;
      } else if (source[i] === "$" && /[A-Za-z_]/.test(source[i + 1] ?? "")) {
        i++; while (/[A-Za-z0-9_]/.test(source[i] ?? "")) i++;
        text += `{${slot++}}`;
      } else text += source[i++];
    }
    throw new Error(`Unclosed Kotlin string at ${start}`);
  };
  let i = 0;
  while (i < source.length) {
    const end = commentEnd(i);
    if (end !== i) i = end;
    else if (source[i] === '"') {
      const item = quoted(i);
      strings.push({ start: i, ...item }); i = item.end;
    } else i++;
  }
  return strings;
}

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory()
    ? files(join(dir, e.name)) : e.name.endsWith(".kt") ? [join(dir, e.name)] : []);
}

if (process.argv[1]?.endsWith("i18n-kotlin.mjs")) {
  const inventory = new Map();
  for (const app of ["mobile-app", "android-app"]) {
    let wrapped = 0;
    for (const path of files(`${app}/app/src/main/java`)) {
      if (path.endsWith("I18n.kt")) continue;
      let source = readFileSync(path, "utf8");
      const strings = kotlinStrings(source).filter((s) => /[\u0600-\u06ff]/.test(s.text));
      for (const s of strings) inventory.set(s.text, path);
      if (app === "android-app" && process.argv.includes("--write-legacy")) {
        let changed = false;
        for (const s of strings.reverse()) {
          if (/\btr\(\s*$/.test(source.slice(Math.max(0, s.start - 20), s.start))) continue;
          source = source.slice(0, s.start) + "tr(" + source.slice(s.start, s.end) + ")" + source.slice(s.end);
          wrapped++; changed = true;
        }
        if (changed) {
          source = source.replace(/^(package [^\n]+\n)/, "$1\nimport com.sellerctrl.app.tr\n");
          writeFileSync(path, source);
        }
      }
    }
    console.log(`${app}: ${wrapped} strings wrapped`);
  }
  writeFileSync("i18n-kotlin-source.json", JSON.stringify([...inventory], null, 2));
  console.log(`${inventory.size} unique Kotlin product strings`);
}
