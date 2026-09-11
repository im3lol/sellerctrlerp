import { describe, it, expect } from "vitest";
import { activeModule, modulesContaining } from "@/lib/active-module";

/**
 * The sidebar shows one module at a time, so "which module is this page in" has to have
 * exactly one answer for every page. Two cases make that non-obvious and both are
 * deliberate, so both are pinned here:
 *
 *   - a goods receipt is listed in المشتريات AND المخزون (it is a purchase step and a
 *     warehouse operation, and Odoo lists it twice for the same reason)
 *   - /reports is a page inside المحاسبة while /reports/center is التقارير's landing
 */

describe("activeModule", () => {
  it("finds the module a page is listed in", () => {
    expect(activeModule("/sales/orders")?.heading).toBe("المبيعات");
    expect(activeModule("/accounting/journal")?.heading).toBe("المحاسبة");
    expect(activeModule("/inventory/items")?.heading).toBe("المخزون");
  });

  it("keeps you in the module you came from when a page is in two", () => {
    const both = modulesContaining("/purchases/receipts").map((s) => s.heading);
    expect(both).toContain("المشتريات");
    expect(both).toContain("المخزون");
    expect(activeModule("/purchases/receipts", "المخزون")?.heading).toBe("المخزون");
    expect(activeModule("/purchases/receipts", "المشتريات")?.heading).toBe("المشتريات");
  });

  it("ignores a remembered module that does not contain the page", () => {
    // Otherwise you'd navigate to accounting and the sidebar would still say المخزون.
    expect(activeModule("/accounting/journal", "المخزون")?.heading).toBe("المحاسبة");
  });

  it("a detail page stays in its module", () => {
    expect(activeModule("/sales/orders/SO-2026-0001")?.heading).toBe("المبيعات");
    expect(activeModule("/inventory/items/abc-123")?.heading).toBe("المخزون");
  });

  it("returns null for pages that belong to no module", () => {
    // The launcher, and the per-user pages reached from the avatar menu.
    expect(activeModule("/apps")).toBeNull();
    expect(activeModule("/profile")).toBeNull();
    expect(activeModule("/search")).toBeNull();
  });

  it("/reports is the accounting statement page, /reports/center is the reports module", () => {
    expect(modulesContaining("/reports").map((s) => s.heading)).toContain("المحاسبة");
    expect(activeModule("/reports/center")?.heading).toBe("التقارير");
  });
});
