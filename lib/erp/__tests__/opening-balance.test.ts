import { describe, it, expect } from "vitest";
import { totals, validateOpening, weigh, type OpeningLine } from "../opening-balance";

const acct = (debit: number, credit = 0): OpeningLine => ({ kind: "ACCOUNT", accountId: "a", debit, credit });
const cust = (debit: number): OpeningLine => ({ kind: "CUSTOMER", customerId: "c", debit });
const supp = (credit: number): OpeningLine => ({ kind: "SUPPLIER", supplierId: "s", credit });
const item = (quantity: number, unitCost: number): OpeningLine => ({ kind: "ITEM", itemId: "i", warehouseId: "w", quantity, unitCost });

describe("weigh", () => {
  it("values opening stock at quantity × unit cost, always as a debit", () => {
    expect(weigh(item(10, 25.5))).toEqual({ debit: 255, credit: 0 });
  });
  it("passes account lines through", () => {
    expect(weigh(acct(0, 900))).toEqual({ debit: 0, credit: 900 });
  });
});

describe("totals", () => {
  it("the balancing figure is what 3002 must take", () => {
    // 50k cash + 30k owed to us + 20k of stock, minus 15k owed to a supplier
    // → 85k of opening equity, credited to 3002.
    const t = totals([acct(50_000), cust(30_000), item(200, 100), supp(15_000)]);
    expect(t.debit).toBe(100_000);
    expect(t.credit).toBe(15_000);
    expect(t.balancing).toBe(85_000);
  });

  it("goes negative when liabilities exceed assets (3002 gets debited)", () => {
    const t = totals([acct(10_000), supp(25_000)]);
    expect(t.balancing).toBe(-15_000);
  });

  it("balancing + credits === debits, so the entry always balances", () => {
    // The property that matters: postEntry throws unless debit === credit, so an
    // opening balance that cannot balance is a company that cannot onboard.
    const sets: OpeningLine[][] = [
      [acct(50_000), cust(30_000), item(200, 100), supp(15_000)],
      [acct(0.01), item(3, 33.33)],
      [supp(999.99)],
      [acct(1_234_567.89), cust(0.01), supp(7.77), item(7, 1.11)],
    ];
    for (const lines of sets) {
      const t = totals(lines);
      const dr = t.debit + (t.balancing < 0 ? -t.balancing : 0);
      const cr = t.credit + (t.balancing > 0 ? t.balancing : 0);
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    }
  });
});

describe("validateOpening", () => {
  it("accepts a normal migration", () => {
    expect(validateOpening([acct(50_000), cust(30_000), supp(15_000), item(200, 100)])).toBeNull();
  });

  it("needs at least one line", () => {
    expect(validateOpening([])).toMatch(/بندًا واحدًا/);
  });

  it("rejects zero-cost opening stock", () => {
    // The nastiest one: it posts fine and balances, then every future sale of that
    // item reports 100% margin and no adjustment can undo it once movements pile up.
    expect(validateOpening([item(10, 0)])).toMatch(/تكلفة/);
  });

  it("rejects zero or negative opening quantity", () => {
    expect(validateOpening([item(0, 10)])).toMatch(/الكمية/);
    expect(validateOpening([item(-5, 10)])).toMatch(/الكمية/);
  });

  it("rejects a customer balance on the credit side", () => {
    // A credit-balance customer is a prepayment — a liability, not receivable. Letting
    // it through would credit 1103 and quietly understate AR.
    expect(validateOpening([{ kind: "CUSTOMER", customerId: "c", credit: 500 }])).toMatch(/مدينًا/);
  });

  it("rejects a supplier balance on the debit side", () => {
    expect(validateOpening([{ kind: "SUPPLIER", supplierId: "s", debit: 500 }])).toMatch(/دائنًا/);
  });

  it("rejects a line that is both debit and credit", () => {
    expect(validateOpening([acct(100, 100)])).toMatch(/مدينًا ودائنًا/);
  });

  it("rejects negative amounts rather than silently flipping the side", () => {
    expect(validateOpening([acct(-100)])).toMatch(/موجبة/);
  });

  it("rejects an empty amount", () => {
    expect(validateOpening([acct(0, 0)])).toMatch(/مبلغًا/);
  });

  it("requires the thing each line points at", () => {
    expect(validateOpening([{ kind: "ACCOUNT", debit: 100 }])).toMatch(/الحساب/);
    expect(validateOpening([{ kind: "CUSTOMER", debit: 100 }])).toMatch(/العميل/);
    expect(validateOpening([{ kind: "SUPPLIER", credit: 100 }])).toMatch(/المورّد/);
    expect(validateOpening([{ kind: "ITEM", quantity: 1, unitCost: 1 }])).toMatch(/الصنف/);
    expect(validateOpening([{ kind: "ITEM", itemId: "i", quantity: 1, unitCost: 1 }])).toMatch(/المخزن/);
  });
});
