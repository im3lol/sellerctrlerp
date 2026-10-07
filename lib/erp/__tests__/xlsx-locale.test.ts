import { describe, expect, it } from "vitest";
import { localizeTable } from "@/lib/erp/xlsx-locale";

describe("localizeTable", () => {
  const aoa = [
    ["رقم الأمر", "الحالة", "سعر الوحدة (EGP)", "السعر المقترح (30%)"],
    ["PO-2026-0001", "مسودة", 120.5, "شركة النور"],
    ["الإجمالي الكلي", null, 120.5, ""],
  ];

  it("leaves an Arabic sheet untouched and right-to-left", () => {
    const r = localizeTable(aoa, "أوامر الشراء", "ar");
    expect(r).toEqual({ aoa, sheet: "أوامر الشراء", rtl: true });
  });

  it("translates headers, labels and the sheet name in English, left-to-right", () => {
    const r = localizeTable(aoa, "أوامر الشراء", "en");
    expect(r.rtl).toBe(false);
    expect(r.sheet).toBe("Purchase orders");
    expect(r.aoa[0]).toEqual(["Order number", "Status", "Unit price (EGP)", "Suggested price (30%)"]);
    // A label cell translates; a name, a number and an empty cell pass through.
    expect(r.aoa[1]).toEqual(["PO-2026-0001", "Draft", 120.5, "شركة النور"]);
    expect(r.aoa[2][0]).toBe("Grand total");
  });
});
