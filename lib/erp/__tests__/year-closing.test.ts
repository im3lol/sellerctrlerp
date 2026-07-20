import { describe, it, expect } from "vitest";
import { computeYearClosing, type PLRow } from "@/lib/erp/year-closing";

const sumDebit = (l: { debit: number }[]) => l.reduce((s, x) => s + x.debit, 0);
const sumCredit = (l: { credit: number }[]) => l.reduce((s, x) => s + x.credit, 0);

describe("computeYearClosing", () => {
  // The audit scenario: a REVENUE account (4102 returns) with a DEBIT balance must
  // reduce net income and get closed — the old `if (amount > 0)` dropped it.
  it("closes a contra-revenue (returns) account and nets income correctly", () => {
    const rows: PLRow[] = [
      { id: "a4101", code: "4101", nameAr: "مبيعات", type: "REVENUE", debit: 0, credit: 1000 },
      { id: "a4102", code: "4102", nameAr: "مردودات المبيعات", type: "REVENUE", debit: 200, credit: 0 },
      { id: "a5101", code: "5101", nameAr: "ت.ب.م", type: "EXPENSE", debit: 600, credit: 0 },
    ];
    const r = computeYearClosing(rows);

    // net income = (1000 - 200) - 600 = 200  (old bug produced 400)
    expect(r.netIncome).toBe(200);
    expect(r.totalRevenue).toBe(800);
    expect(r.totalExpense).toBe(600);

    // 4102 IS included and closed by a CREDIT of 200 (zeroing its 200 debit)
    const l4102 = r.plLines.find((l) => l.accountId === "a4102");
    expect(l4102).toBeDefined();
    expect(l4102).toMatchObject({ debit: 0, credit: 200 });
    // 4101 closed by a debit; 5101 by a credit
    expect(r.plLines.find((l) => l.accountId === "a4101")).toMatchObject({ debit: 1000, credit: 0 });
    expect(r.plLines.find((l) => l.accountId === "a5101")).toMatchObject({ debit: 0, credit: 600 });

    // The P&L lines alone net to a debit of exactly netIncome (retained gets the credit)
    expect(sumDebit(r.plLines) - sumCredit(r.plLines)).toBe(r.netIncome);
  });

  it("handles a contra-expense (credit-balance expense) symmetrically", () => {
    const rows: PLRow[] = [
      { id: "r", code: "4101", nameAr: "مبيعات", type: "REVENUE", debit: 0, credit: 500 },
      { id: "e", code: "5301", nameAr: "خصم مكتسب", type: "EXPENSE", debit: 0, credit: 80 }, // contra-expense
    ];
    const r = computeYearClosing(rows);
    // expense net = 0 - 80 = -80 → net income = 500 - (-80) = 580
    expect(r.netIncome).toBe(580);
    expect(r.plLines.find((l) => l.accountId === "e")).toMatchObject({ debit: 80, credit: 0 });
  });

  it("skips exactly-zero accounts and a plain profit balances", () => {
    const rows: PLRow[] = [
      { id: "r", code: "4101", nameAr: "مبيعات", type: "REVENUE", debit: 0, credit: 1000 },
      { id: "z", code: "4999", nameAr: "صفر", type: "REVENUE", debit: 50, credit: 50 },
      { id: "e", code: "5101", nameAr: "ت.ب.م", type: "EXPENSE", debit: 400, credit: 0 },
    ];
    const r = computeYearClosing(rows);
    expect(r.plLines.some((l) => l.accountId === "z")).toBe(false);
    expect(r.netIncome).toBe(600);
  });
});
