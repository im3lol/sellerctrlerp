import { describe, expect, it } from "vitest";
import { documentLedgerTotals, type LedgerAmountRow } from "../document-ledger-totals";

const row = (patch: Partial<LedgerAmountRow> = {}): LedgerAmountRow => ({
  docType: "INVOICE", status: "POSTED", qtyTotal: 1,
  subtotal: 7807.02, discount: 0, tax: 1092.98, total: 8900, ...patch,
});

describe("lifecycle ledger accounting", () => {
  it("counts a sale once instead of adding order, delivery and invoice", () => {
    const totals = documentLedgerTotals([
      row({ docType: "ORDER", status: "INVOICED", qtyDelivered: 1 }),
      row({ docType: "DELIVERY", status: "DELIVERED", subtotal: null, tax: null, total: null }), row(),
    ]);
    expect(totals).toMatchObject({ total: 8900, qtyTotal: 1, qtyDelivered: 1, tax: 1092.98 });
  });
  it.each(["DRAFT", "CANCELLED", "REVERSED", "UNKNOWN"])("excludes %s from recognized totals", status => {
    expect(documentLedgerTotals([row({ status })]).total).toBe(0);
  });
  it.each(["POSTED", "PARTIAL_PAID", "PAID"])("includes %s invoices once", status => {
    expect(documentLedgerTotals([row({ status })]).total).toBe(8900);
  });
  it("deducts invoice credit notes but never double-deducts the stock return", () => {
    const totals = documentLedgerTotals([row(),
      row({ docType: "RETURN", financialReturn: true, subtotal: 100, tax: 14, total: 114 }),
      row({ docType: "RETURN", financialReturn: false, qtyDelivered: 1, subtotal: null, tax: null, total: 100 }),
      row({ docType: "DELIVERY", status: "DELIVERED", subtotal: null, tax: null, total: null }),
    ]);
    expect(totals).toMatchObject({ total: 8786, subtotal: 7707.02, tax: 1078.98, qtyTotal: 0, qtyDelivered: 0 });
  });
  it("keeps purchasing receipt quantities separate from invoices and orders", () => {
    const totals = documentLedgerTotals([row(),
      row({ docType: "ORDER", status: "INVOICED", qtyReceived: 1 }),
      row({ docType: "RECEIPT", status: "RECEIVED", qtyReceived: 1, qtyRejected: 2 }),
      row({ docType: "RETURN", financialReturn: false, qtyReceived: 0.25 }),
    ]);
    expect(totals).toMatchObject({ total: 8900, qtyTotal: 1, qtyReceived: 0.75, qtyRejected: 2 });
  });
  it("supports operational type filters without summing other stages", () => {
    expect(documentLedgerTotals([row({ docType: "ORDER", status: "CONFIRMED" }), row()], "ORDER").total).toBe(8900);
    expect(documentLedgerTotals([row({ docType: "ORDER", status: "DRAFT" })], "ORDER").total).toBe(0);
    expect(documentLedgerTotals([row({ docType: "RETURN", financialReturn: true })], "RETURN").total).toBe(-8900);
  });
  it("sums money in integer minor units and preserves fractional quantities", () => {
    const totals = documentLedgerTotals([row({ total: 0.1, qtyTotal: 0.0001 }), row({ total: 0.2, qtyTotal: 0.0002 })]);
    expect(totals.total).toBe(0.3);
    expect(totals.qtyTotal).toBe(0.0003);
  });
});
