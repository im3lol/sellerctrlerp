import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EN } from "@/lib/i18n/en";
import { fill, translator } from "@/lib/i18n";
import { translateContent } from "@/lib/i18n/content";
import englishContent from "@/lib/i18n/content-en.json";

const arabic = /[\u0600-\u06ff]/;

function uiFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? uiFiles(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

function serverFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? (["__tests__", "i18n"].includes(entry.name) ? [] : serverFiles(path))
      : path.endsWith(".ts") ? [path] : [];
  });
}

describe("English UI coverage", () => {
  it("keeps the native mobile dictionary in sync with the web", () => {
    for (const app of ["mobile-app", "android-app"]) {
      const mobile = JSON.parse(readFileSync(`${app}/app/src/main/assets/i18n/en.json`, "utf8"));
      const mismatches = [...new Set([...Object.keys(mobile), ...Object.keys(EN)])]
        .filter((key) => mobile[key] !== EN[key]);
      expect(mismatches).toEqual([]);
    }
  });

  it("has dictionary entries for every static Arabic UI string", () => {
    const missing: string[] = [];
    for (const path of [...uiFiles("app"), ...uiFiles("components")]) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && arabic.test(node.text) && !EN[node.text]) {
          missing.push(`${path}: ${node.text}`);
        }
        // Text nodes bypass t() entirely, even when their text exists in the dictionary.
        if (ts.isJsxText(node) && arabic.test(node.text)) {
          missing.push(`${path}: untranslated JSX text: ${node.text.trim()}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it("translates allocation labels, validation messages and item shares", () => {
    const t = translator("en");
    expect(t("مصاريف وخصومات أمر الشراء")).toBe("Purchase order charges and discounts");
    expect(t("مجموع التوزيع اليدوي يجب أن يساوي قيمة المصروف أو الخصم"))
      .toBe("The manual allocation total must equal the charge or discount amount");
    expect(fill(t("نصيب {0}"), ["حقيبة العميل"]))
      .toBe("Allocated share for حقيبة العميل");
    expect(translator("ar")("بانتظار التوزيع")).toBe("بانتظار التوزيع");
  });

  it("covers server-side product labels and validation errors", () => {
    const missing: string[] = [];
    const t = translator("en");
    const parsingCharacters = new Set(["ا", "ي", "ه", "٠١٢٣٤٥٦٧٨٩"]);
    for (const path of [...serverFiles("app/actions"), ...serverFiles("app/api"), ...serverFiles("lib")]) {
      // Demo party/item names are master data. Amount-in-words has explicit locale branches.
      if (path.endsWith("sandbox.ts") || path.endsWith("print-format.ts")) continue;
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && arabic.test(node.text) && !parsingCharacters.has(node.text)
          && arabic.test(t(node.text))) missing.push(`${path}: ${node.text}`);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it("translates all authored academy and release-note paragraphs", () => {
    const missing: string[] = [];
    for (const path of ["db/seed-academy.ts", "db/seed-academy-docs.ts", "scripts/seed-changelog.ts"]) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          for (const block of node.text.split(/\n\s*\n/)) {
            if (arabic.test(block) && arabic.test(translateContent(block, "en"))) missing.push(`${path}: ${block}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it("preserves Markdown links, blank lines and the original Arabic content", () => {
    const source = "  المطابقة البنكية\n\nالفواتير الدورية  ";
    expect(translateContent(source, "ar")).toBe(source);
    expect(translateContent(source, "en")).toBe("  Bank reconciliation\n\nRecurring invoices  ");
    const link = "[SKU](https://example.com/a?q=1)";
    expect(translateContent(link, "en")).toBe(link);
    for (const [original, translated] of Object.entries(englishContent)) {
      const destinations = (text: string) => [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
      expect(destinations(translated), original).toEqual(destinations(original));
    }
  });

  it("translates nested accounting descriptions without changing party names or codes", () => {
    const t = translator("en");
    expect(t("عكس: فاتورة بيع INV-1")).toBe("Reversal: Sales invoice INV-1");
    expect(t("1101 — النقدية")).toBe("1101 — Cash");
    expect(t("سطر 2: حفظ")).toBe("Row 2: Save");
    expect(t("شركة العميل الخاصة")).toBe("شركة العميل الخاصة");
  });

  it("translates historical marketplace correction entries and lines", () => {
    const t = translator("en");
    const descriptions = [
      "تصحيح ضريبة مخرجات سُجّلت خطأً على أوامر المنصات",
      "تصحيح إجمالي أمر منصة SO-2026-0017 — خصم شحن لم يُسجَّل",
      "عكس ضريبة مخرجات أوامر المنصات",
      "إيراد مبيعات كان مُدرجاً كضريبة",
      "عكس إيراد زائد SI-2026-0015",
      "تخفيض مديونية العميل SI-2026-0015",
    ];
    for (const source of descriptions) {
      expect(t(source)).not.toMatch(arabic);
      expect(translator("ar")(source)).toBe(source);
    }
    expect(t(descriptions[1])).toBe("Correct marketplace order total SO-2026-0017 — previously unrecorded shipping discount");
    expect(t(descriptions[4])).toContain("SI-2026-0015");
  });
});
