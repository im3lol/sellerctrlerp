import { describe, it, expect } from "vitest";
import { naturalAmount, type AccountBalance } from "../financials";

const mk = (type: string, normalBalance: "DEBIT" | "CREDIT", balance: number): AccountBalance =>
  ({ id: "x", code: "0", nameAr: "x", type, subtype: null, normalBalance, debit: 0, credit: 0, balance }) as unknown as AccountBalance;

describe("naturalAmount", () => {
  it("debit-natural types keep their sign (assets/expenses)", () => {
    expect(naturalAmount(mk("ASSET", "DEBIT", 500))).toBe(500);
    expect(naturalAmount(mk("ASSET", "DEBIT", -20))).toBe(-20);
    expect(naturalAmount(mk("EXPENSE", "DEBIT", 300))).toBe(300);
  });

  it("credit-natural types flip sign (liabilities/equity/revenue)", () => {
    // balance is debit − credit, so a credit-natural account with a net credit has
    // a negative balance → naturalAmount presents it positive.
    expect(naturalAmount(mk("LIABILITY", "CREDIT", -800))).toBe(800);
    expect(naturalAmount(mk("REVENUE", "CREDIT", -50_000))).toBe(50_000);
    expect(naturalAmount(mk("EQUITY", "CREDIT", -100_000))).toBe(100_000);
    expect(naturalAmount(mk("LIABILITY", "CREDIT", 30))).toBe(-30);
  });

  // The sign has to follow `type`, because every caller buckets by `type`. On a
  // contra account the two disagree, and signing by normalBalance puts the line in
  // its bucket's total with the wrong sign.
  it("contra-asset (accumulated depreciation) deducts from assets", () => {
    // ASSET account carrying a 30k credit balance. Signed by normalBalance this
    // returns +30_000 and gets ADDED to total assets — assets overstate by 60k and
    // the balance sheet stops balancing.
    expect(naturalAmount(mk("ASSET", "CREDIT", -30_000))).toBe(-30_000);
  });

  it("contra-revenue (sales discount) reduces revenue", () => {
    // REVENUE account carrying a 500 debit balance. Signed by normalBalance this
    // returns +500 and inflates revenue by the discount given away.
    expect(naturalAmount(mk("REVENUE", "DEBIT", 500))).toBe(-500);
  });

  it("4102 مردودات المبيعات (REVENUE/CREDIT, debit balance) reduces revenue", () => {
    // The default chart models returns as REVENUE/CREDIT, so this one works either
    // way — pinned to catch a regression if the sign rule is ever revisited.
    expect(naturalAmount(mk("REVENUE", "CREDIT", 1_000))).toBe(-1_000);
  });
});
