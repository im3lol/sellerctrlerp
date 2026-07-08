import { describe, it, expect } from "vitest";
import { normalizeCode } from "../amazon-import";
import { parseAmazonDate, settlementDedupKey, type SettlementTxn } from "../amazon-settlement";

describe("normalizeCode", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(normalizeCode("abc-123")).toBe("ABC123");
    expect(normalizeCode("  a b!c ")).toBe("ABC");
    expect(normalizeCode("B0G9YN9XMT")).toBe("B0G9YN9XMT");
  });
});

describe("parseAmazonDate", () => {
  it("parses Amazon's '…PM UTC' timestamp to a UTC Date", () => {
    const d = parseAmazonDate("1 Jun 2026 5:28:50 PM UTC");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCFullYear()).toBe(2026);
    expect(d!.getUTCMonth()).toBe(5); // June
    expect(d!.getUTCHours()).toBe(17); // 5 PM
  });
  it("handles 12 AM/PM correctly", () => {
    expect(parseAmazonDate("3 Jan 2026 12:00:00 AM UTC")!.getUTCHours()).toBe(0);
    expect(parseAmazonDate("3 Jan 2026 12:00:00 PM UTC")!.getUTCHours()).toBe(12);
  });
  it("returns null for unparseable input", () => {
    expect(parseAmazonDate("garbage")).toBeNull();
    expect(parseAmazonDate("")).toBeNull();
  });
});

describe("settlementDedupKey", () => {
  const base = { settlementId: "S1", type: "Order", orderId: "111-222", sku: "SKU1", total: 12.5 } as Partial<SettlementTxn>;
  it("is stable for identical rows", () => {
    const a = settlementDedupKey({ ...base, postedAt: new Date("2026-06-01T00:00:00Z") } as SettlementTxn);
    const b = settlementDedupKey({ ...base, postedAt: new Date("2026-06-01T00:00:00Z") } as SettlementTxn);
    expect(a).toBe(b);
  });
  it("differs when a field differs", () => {
    const a = settlementDedupKey({ ...base, postedAt: null } as SettlementTxn);
    const b = settlementDedupKey({ ...base, type: "Refund", postedAt: null } as SettlementTxn);
    expect(a).not.toBe(b);
  });
});
