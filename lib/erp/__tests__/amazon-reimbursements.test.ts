import { describe, it, expect } from "vitest";
import { parseReimbursementsReport } from "../amazon-reimbursements";
import { parseLedgerReport, ledgerDedupKey } from "../amazon-ledger";

const RH = "approval-date\treimbursement-id\tcase-id\tamazon-order-id\treason\tsku\tfnsku\tasin\tproduct-name\tcondition\tcurrency-unit\tamount-per-unit\tamount-total\tquantity-reimbursed-cash\tquantity-reimbursed-inventory\tquantity-reimbursed-total\toriginal-reimbursement-id\toriginal-reimbursement-type";

const rrow = (over: Partial<Record<string, string>> = {}) => {
  const d: Record<string, string> = {
    "approval-date": "2026-06-15T08:00:00+00:00", "reimbursement-id": "RB123", "case-id": "C1",
    "amazon-order-id": "", reason: "Lost_warehouse", sku: "SKU-1", fnsku: "X01", asin: "B01",
    "product-name": "منتج", condition: "New", "currency-unit": "EGP", "amount-per-unit": "150.5",
    "amount-total": "301", "quantity-reimbursed-cash": "2", "quantity-reimbursed-inventory": "0",
    "quantity-reimbursed-total": "2", "original-reimbursement-id": "", "original-reimbursement-type": "",
    ...over,
  };
  return RH.split("\t").map((h) => d[h] ?? "").join("\t");
};

describe("parseReimbursementsReport", () => {
  it("parses rows keyed by header", () => {
    const rows = parseReimbursementsReport([RH, rrow(), rrow({ "reimbursement-id": "RB124", sku: "SKU-2", "quantity-reimbursed-inventory": "1", "quantity-reimbursed-cash": "0" })].join("\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reimbursementId: "RB123", reason: "Lost_warehouse", amountPerUnit: 150.5, amountTotal: 301, quantityReimbursedCash: 2 });
    expect(rows[1].quantityReimbursedInventory).toBe(1);
  });

  it("skips rows without a reimbursement id and handles empty input", () => {
    expect(parseReimbursementsReport("")).toEqual([]);
    expect(parseReimbursementsReport([RH, rrow({ "reimbursement-id": "" }), rrow()].join("\n"))).toHaveLength(1);
  });
});

const LH = "date\tfnsku\tasin\tmsku\ttitle\tevent type\treference id\tquantity\tfulfillment center\tdisposition\treason\tcountry";
const lrow = (over: Partial<Record<string, string>> = {}) => {
  const d: Record<string, string> = {
    date: "2026-06-20", fnsku: "X01", asin: "B01", msku: "SKU-1", title: "منتج",
    "event type": "Adjustments", "reference id": "ADJ-1", quantity: "-3",
    "fulfillment center": "CAI1", disposition: "SELLABLE", reason: "M", country: "EG",
    ...over,
  };
  return LH.split("\t").map((h) => d[h] ?? "").join("\t");
};

describe("parseLedgerReport", () => {
  it("parses events with signed quantities", () => {
    const rows = parseLedgerReport([LH, lrow(), lrow({ "event type": "CustomerReturns", quantity: "1", "reference id": "LPN1" })].join("\n"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sku: "SKU-1", eventType: "Adjustments", quantity: -3 });
    expect(rows[1].eventType).toBe("CustomerReturns");
  });

  it("dedup key is stable and event-distinct", () => {
    const [a] = parseLedgerReport([LH, lrow()].join("\n"));
    const [b] = parseLedgerReport([LH, lrow()].join("\n"));
    const [c] = parseLedgerReport([LH, lrow({ quantity: "-4" })].join("\n"));
    expect(ledgerDedupKey(a)).toBe(ledgerDedupKey(b));
    expect(ledgerDedupKey(a)).not.toBe(ledgerDedupKey(c));
  });
});
