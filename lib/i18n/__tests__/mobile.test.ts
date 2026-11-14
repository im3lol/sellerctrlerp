import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kotlinStrings } from "../../../scripts/i18n-kotlin.mjs";
import { EN } from "../en";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".kt") ? [path] : [];
  });
}

describe("Android translation coverage", () => {
  it("covers static and interpolated product strings in both native apps", () => {
    const missing: string[] = [];
    for (const app of ["android-app", "mobile-app"]) {
      for (const path of files(`${app}/app/src/main/java`)) {
        if (path.endsWith("I18n.kt")) continue;
        for (const value of kotlinStrings(readFileSync(path, "utf8"))) {
          if (/[\u0600-\u06ff]/.test(value.text) && !EN[value.text]) missing.push(`${path}: ${value.text}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
  it("ignores comments and handles quotes inside interpolations", () => {
    const values = kotlinStrings('// "ignore"\nval s = "Value ${if (ok) "yes" else "no"}: $count"');
    expect(values.map((value) => value.text)).toEqual(["Value {0}: {1}"]);
  });
});
