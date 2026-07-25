import { describe, it, expect } from "vitest";
import { normalizeCode } from "../amazon-import";
import { parseAmazonDate, parseSettlementFlatFile, settlementDedupKey, type SettlementTxn } from "../amazon-settlement";
import { splitSettlementRows, perOrderGL, nonOrderGL, orderReceivable, orderFees, type SettleAmounts } from "../settlement-gl";

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

describe("settlement per-order split + GL", () => {
  const amt = (o: Partial<SettleAmounts>): SettleAmounts => ({
    type: "Order", productSales: 0, shippingCredits: 0, promotionalRebates: 0,
    sellingFees: 0, fbaFees: 0, otherTransactionFees: 0, other: 0, total: 0, ...o,
  });
  // An order: sold 100, commission -15, FBA -5 → net 80.
  const soldOrder = (salesOrderId: string | null) => ({
    ...amt({ productSales: 100, sellingFees: -15, fbaFees: -5, total: 80 }), salesOrderId,
  });

  it("groups matched orders, holds unimported ones, buckets non-order rows", () => {
    const rows = [
      soldOrder("SO-1"), soldOrder("SO-1"),   // same order, two lines
      soldOrder("SO-2"),
      soldOrder(null),                         // unimported → held, never touches AR
      { ...amt({ type: "Transfer", total: -160 }), salesOrderId: null },
      { ...amt({ type: "ServiceFee", total: -30 }), salesOrderId: null },
      { ...amt({ type: "Refund", productSales: -100, total: -80 }), salesOrderId: "SO-1" },
    ];
    const { orderGroups, heldOrderRows, nonOrderRows, refundRows } = splitSettlementRows(rows);
    expect(orderGroups.get("SO-1")).toHaveLength(2);
    expect(orderGroups.get("SO-2")).toHaveLength(1);
    expect(heldOrderRows).toHaveLength(1);   // the null-order sale
    expect(nonOrderRows).toHaveLength(2);    // transfer + service fee
    expect(refundRows).toHaveLength(1);      // owned by the return cycle
  });

  it("per-order entry balances: Cr receivable = Dr clearing + Dr fees", () => {
    const gl = perOrderGL([soldOrder("SO-1"), soldOrder("SO-1")]);
    expect(orderReceivable(soldOrder("SO-1"))).toBe(100);
    expect(orderFees(soldOrder("SO-1"))).toBe(20); // 15 + 5
    expect(gl.receivable).toBe(200);
    expect(gl.fees).toBe(40);
    expect(gl.clearing).toBe(160);
    expect(gl.receivable).toBeCloseTo(gl.clearing + gl.fees, 5); // Cr = Dr + Dr
  });

  it("non-order aggregate splits transfers (bank) from fees", () => {
    const gl = nonOrderGL([
      amt({ type: "Transfer", total: -160 }),
      amt({ type: "ServiceFee", total: -30 }),
      amt({ type: "SAFE-T Reimbursement", total: 12 }),
    ]);
    expect(gl.bank).toBe(160);        // money leaving Amazon → our bank (Dr)
    expect(gl.fees).toBe(30 - 12);    // service fee expense minus SAFE-T offset
    expect(gl.clearing).toBe(-178);   // net drain from the clearing account
  });
});
