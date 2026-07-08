import { describe, it, expect } from "vitest";
import { naturalAmount, type AccountBalance } from "../financials";

const mk = (normalBalance: "DEBIT" | "CREDIT", balance: number): AccountBalance =>
  ({ id: "x", code: "0", nameAr: "x", type: "ASSET", subtype: null, normalBalance, debit: 0, credit: 0, balance }) as unknown as AccountBalance;

describe("naturalAmount", () => {
  it("debit-normal accounts keep their sign (assets/expenses)", () => {
    expect(naturalAmount(mk("DEBIT", 500))).toBe(500);
    expect(naturalAmount(mk("DEBIT", -20))).toBe(-20);
  });
  it("credit-normal accounts flip sign (liabilities/equity/revenue)", () => {
    // balance is debit − credit, so a credit-normal account with net credit has a
    // negative balance → naturalAmount presents it positive.
    expect(naturalAmount(mk("CREDIT", -800))).toBe(800);
    expect(naturalAmount(mk("CREDIT", 30))).toBe(-30);
  });
});
