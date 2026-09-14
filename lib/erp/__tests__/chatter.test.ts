import { describe, it, expect } from "vitest";
import { followUpState, cairoToday, isChatterKind, docHref } from "@/lib/erp/chatter";

describe("followUpState", () => {
  const today = "2026-09-14";
  it("done wins over any date", () => {
    expect(followUpState("2026-09-01", "2026-09-10T10:00:00Z", today)).toBe("done");
  });
  it("past, today, or ahead", () => {
    expect(followUpState("2026-09-13", null, today)).toBe("overdue");
    expect(followUpState("2026-09-14", null, today)).toBe("today");
    expect(followUpState("2026-09-20", null, today)).toBe("soon");
  });
});

describe("cairoToday", () => {
  it("is the date in Cairo, not UTC", () => {
    // 23:30 UTC on the 13th is already the 14th in Cairo (UTC+3 in September).
    expect(cairoToday(new Date("2026-09-13T23:30:00Z"))).toBe("2026-09-14");
  });
});

describe("chatter kinds", () => {
  it("only known document kinds are accepted, and link to their page by number", () => {
    expect(isChatterKind("SALES_ORDER")).toBe(true);
    expect(isChatterKind("constructor")).toBe(false);
    expect(docHref("PURCHASE_ORDER", "PO-2026-0007")).toBe("/purchases/orders/PO-2026-0007");
  });
});
