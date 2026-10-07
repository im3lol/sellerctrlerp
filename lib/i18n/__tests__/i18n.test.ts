import { describe, expect, it } from "vitest";
import { translator, dirOf, money, qty, int, date, isLocale, LOCALES } from "@/lib/i18n";
import { EN } from "@/lib/i18n/en";

describe("i18n core", () => {
  it("returns the Arabic source untouched in Arabic", () => {
    const t = translator("ar");
    expect(t("حفظ")).toBe("حفظ");
    expect(t("نص لا توجد له ترجمة إطلاقًا")).toBe("نص لا توجد له ترجمة إطلاقًا");
  });

  it("translates in English and falls back to Arabic when an entry is missing", () => {
    const t = translator("en");
    expect(t("حفظ")).toBe("Save");
    // The fallback is the whole point: an untranslated screen stays usable.
    expect(t("نص لا توجد له ترجمة إطلاقًا")).toBe("نص لا توجد له ترجمة إطلاقًا");
  });

  it("flips direction with the language", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });

  it("formats numbers with Latin digits in both languages", () => {
    for (const l of LOCALES) {
      expect(money(1234.5, l)).toMatch(/1.?234\.50/);
      expect(qty(3, l)).toBe("3");
      expect(int(1000, l)).toMatch(/1.?000/);
      expect(date("2026-03-09", l)).toMatch(/2026/);
    }
  });

  it("accepts only known locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("has no empty or duplicated-to-Arabic entries in the dictionary", () => {
    for (const [ar, en] of Object.entries(EN)) {
      expect(en.trim()).not.toBe("");
      expect(en).not.toBe(ar); // an entry that equals its key is a forgotten translation
    }
  });
});

describe("fill", () => {
  it("puts values into numbered slots, in whatever order the sentence needs", async () => {
    const { fill } = await import("@/lib/i18n");
    expect(fill("من {0} إلى {1}", ["1 يناير", "5 يناير"])).toBe("من 1 يناير إلى 5 يناير");
    expect(fill("{1} back to {0}", ["a", "b"])).toBe("b back to a");
    expect(fill("{0} و{2}", ["x"])).toBe("x و{2}");
  });
});

describe("sentences with values", () => {
  const t = translator("en");
  it("translates a message built around values by its slotted entry", () => {
    expect(t("فاتورة بيع SI-2026-0005")).toBe("Sales invoice SI-2026-0005");
    expect(t("سند قبض RV-2026-0001 — تحويل بنكي")).toBe("Receipt RV-2026-0001 — Bank transfer");
  });
  it("leaves names and unknown text alone", () => {
    expect(t("شاحن سريع 65 واط")).toBe("شاحن سريع 65 واط");
    expect(t("PO-2026-0001")).toBe("PO-2026-0001");
  });
  it("is a no-op in Arabic", () => {
    expect(translator("ar")("فاتورة بيع SI-2026-0005")).toBe("فاتورة بيع SI-2026-0005");
  });
});

describe("a code, then a name", () => {
  const t = translator("en");
  it("translates the name after a code", () => {
    expect(t("1101 — النقدية")).toBe("1101 — Cash");
    expect(t("ITM-1001 — ساعة ذكية رياضية")).toBe("ITM-1001 — ساعة ذكية رياضية");
  });
});
