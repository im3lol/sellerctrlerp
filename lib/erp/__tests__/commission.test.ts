import { describe, it, expect } from "vitest";
import {
  ruleFor, computeCommissions, summarise, validateRule,
  type Rule, type InvoiceFact, type ReceiptFact,
} from "@/lib/erp/commission";

const collected: Rule = { employeeId: "REP1", basis: "COLLECTED", percent: 5 };
const invoiced: Rule = { employeeId: "REP1", basis: "INVOICED", percent: 5 };
const fallback: Rule = { employeeId: null, basis: "COLLECTED", percent: 2 };

const inv = (over: Partial<InvoiceFact> = {}): InvoiceFact => ({
  id: "I1", number: "SI-1", salesRepId: "REP1", customerName: "عميل",
  date: "2026-03-10", amount: 1000, ...over,
});
const rec = (over: Partial<ReceiptFact> = {}): ReceiptFact => ({
  id: "R1", number: "RV-1", salesInvoiceId: "I1", date: "2026-03-20", amount: 1000, ...over,
});

describe("which rule applies", () => {
  it("prefers the rep's own rule over the default", () => {
    expect(ruleFor([fallback, collected], "REP1", "2026-03-10")?.percent).toBe(5);
  });

  it("falls back to the org default for a rep with no rule", () => {
    expect(ruleFor([fallback, collected], "REP2", "2026-03-10")?.percent).toBe(2);
  });

  it("earns nothing when neither applies — never another rep's percentage", () => {
    expect(ruleFor([collected], "REP2", "2026-03-10")).toBeNull();
  });

  it("respects the validity window, inclusive of the last day", () => {
    const windowed: Rule = { ...collected, validFrom: "2026-01-01", validTo: "2026-03-10" };
    expect(ruleFor([windowed], "REP1", "2026-03-10")).not.toBeNull();
    expect(ruleFor([windowed], "REP1", "2026-03-11")).toBeNull();
    expect(ruleFor([windowed], "REP1", "2025-12-31")).toBeNull();
  });

  it("ignores a deactivated rule", () => {
    expect(ruleFor([{ ...collected, isActive: false }], "REP1", "2026-03-10")).toBeNull();
  });
});

describe("earning on collection", () => {
  it("pays when the customer pays, not when the invoice is issued", () => {
    const rows = computeCommissions([collected], [inv()], [rec()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("RECEIPT");
    expect(rows[0].commission).toBe(50);
    expect(rows[0].date).toBe("2026-03-20");
  });

  it("pays nothing on an invoice nobody has paid yet", () => {
    expect(computeCommissions([collected], [inv()], [])).toEqual([]);
  });

  it("pays proportionally on a part payment", () => {
    const rows = computeCommissions([collected], [inv()], [rec({ amount: 400 })]);
    expect(rows[0].commission).toBe(20);
  });

  it("ignores a payment on account that traces to no invoice", () => {
    expect(computeCommissions([collected], [inv()], [rec({ salesInvoiceId: null })])).toEqual([]);
  });

  it("ignores a receipt against an invoice with no rep", () => {
    expect(computeCommissions([collected], [inv({ salesRepId: null })], [rec()])).toEqual([]);
  });
});

describe("earning on invoicing", () => {
  it("pays on the invoice and ignores the receipt", () => {
    const rows = computeCommissions([invoiced], [inv()], [rec()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceType).toBe("INVOICE");
    expect(rows[0].commission).toBe(50);
  });

  it("never pays twice on the same money", () => {
    const rows = computeCommissions([invoiced], [inv()], [rec(), rec({ id: "R2", number: "RV-2" })]);
    expect(rows).toHaveLength(1);
  });
});

describe("totals", () => {
  it("adds up per rep, biggest first", () => {
    const rules: Rule[] = [collected, { employeeId: "REP2", basis: "COLLECTED", percent: 10 }];
    const invoices = [inv(), inv({ id: "I2", number: "SI-2", salesRepId: "REP2" })];
    const receipts = [rec(), rec({ id: "R2", number: "RV-2", salesInvoiceId: "I2", amount: 1000 })];
    const totals = summarise(computeCommissions(rules, invoices, receipts));
    expect(totals[0]).toEqual({ repId: "REP2", base: 1000, commission: 100, count: 1 });
    expect(totals[1]).toEqual({ repId: "REP1", base: 1000, commission: 50, count: 1 });
  });
});

describe("rule validation", () => {
  it("accepts a sane rule", () => {
    expect(validateRule({ percent: 5, basis: "COLLECTED" })).toBeNull();
    expect(validateRule({ percent: 0, basis: "INVOICED" })).toBeNull();
  });

  it("refuses a percentage that is certainly a typo", () => {
    expect(validateRule({ percent: 150, basis: "COLLECTED" })).toMatch(/١٠٠/);
    expect(validateRule({ percent: -1, basis: "COLLECTED" })).toMatch(/صفر أو أكبر/);
  });

  it("refuses an unknown basis and a backwards window", () => {
    expect(validateRule({ percent: 5, basis: "MAGIC" })).toMatch(/أساس/);
    expect(validateRule({ percent: 5, basis: "COLLECTED", validFrom: "2026-05-01", validTo: "2026-01-01" }))
      .toMatch(/قبل البداية/);
  });
});
