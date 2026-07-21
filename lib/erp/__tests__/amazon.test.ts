import { describe, it, expect } from "vitest";
import { normalizeCode } from "../amazon-import";
import { parseAmazonDate, parseSettlementFlatFile, settlementDedupKey, type SettlementTxn } from "../amazon-settlement";

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

describe("parseSettlementFlatFile", () => {
  const HEAD = ["settlement-id", "deposit-date", "total-amount", "transaction-type", "order-id", "adjustment-id", "shipment-id", "amount-type", "amount-description", "amount", "sku", "quantity-purchased", "posted-date-time"];
  const row = (v: (string | number)[]) => v.map(String).join("\t");
  // One settlement: a deposit of 8.00 = one order (principal 10 − commission 1.5 − FBA fee 0.5).
  const tsv = [
    HEAD.join("\t"),
    row(["S1", "2026-06-15T00:00:00Z", "8.00", "", "", "", "", "", "", "", "", "", ""]),
    row(["S1", "", "", "Order", "111-1", "", "SH1", "ItemPrice", "Principal", "10.00", "SKU1", "1", "2026-06-10T00:00:00Z"]),
    row(["S1", "", "", "Order", "111-1", "", "SH1", "ItemFees", "Commission", "-1.50", "SKU1", "1", "2026-06-10T00:00:00Z"]),
    row(["S1", "", "", "Order", "111-1", "", "SH1", "ItemFees", "FBAPerUnitFulfillmentFee", "-0.50", "SKU1", "1", "2026-06-10T00:00:00Z"]),
  ].join("\n");

  it("pivots components into buckets and negates the deposit", () => {
    const txns = parseSettlementFlatFile(tsv);
    const order = txns.find((t) => t.type === "Order")!;
    expect(order.productSales).toBe(10);
    expect(order.sellingFees).toBe(-1.5);
    expect(order.fbaFees).toBe(-0.5);
    expect(order.total).toBe(8);
    expect(order.orderId).toBe("111-1");
    expect(order.sku).toBe("SKU1");
    expect(order.status).toBe("Released");

    const transfer = txns.find((t) => t.type === "Transfer")!;
    expect(transfer.total).toBe(-8); // money leaving Amazon → bank
  });

  it("nets the whole settlement to zero (so the GL entry balances)", () => {
    const txns = parseSettlementFlatFile(tsv);
    const sum = txns.reduce((s, t) => s + t.total, 0);
    expect(Math.abs(sum)).toBeLessThan(0.001);
  });

  it("returns empty for a header-only / blank file", () => {
    expect(parseSettlementFlatFile("")).toEqual([]);
    expect(parseSettlementFlatFile(HEAD.join("\t"))).toEqual([]);
  });
});
