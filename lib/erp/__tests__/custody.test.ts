import { describe, it, expect } from "vitest";
import {
  outstanding, settlementTotal, spentTotal, validateSettlement, closesAdvance,
  issueEntryLines, settlementEntryLines,
} from "@/lib/erp/custody";

const line = (amount: number, acc = "EXP") => ({ expenseAccountId: acc, amount });

describe("outstanding balance", () => {
  it("is what was advanced minus what has been accounted for", () => {
    expect(outstanding(5000, 0)).toBe(5000);
    expect(outstanding(5000, 1800.5)).toBe(3199.5);
    expect(outstanding(5000, 5000)).toBe(0);
  });
});

describe("what a settlement clears", () => {
  it("counts spending and returned cash together", () => {
    expect(settlementTotal([line(1200), line(300)], 500)).toBe(2000);
    expect(spentTotal([line(1200), line(300)])).toBe(1500);
  });

  it("handles a settlement that is only returned cash", () => {
    expect(settlementTotal([], 750)).toBe(750);
  });
});

describe("validation", () => {
  const base = { advanceAmount: 5000, alreadySettled: 0 };

  it("accepts a settlement inside the balance", () => {
    expect(validateSettlement({ ...base, lines: [line(1500)], returnedAmount: 500 })).toBeNull();
  });

  it("accepts one that clears the balance exactly", () => {
    expect(validateSettlement({ ...base, lines: [line(4500)], returnedAmount: 500 })).toBeNull();
  });

  it("refuses accounting for more than was advanced", () => {
    const err = validateSettlement({ ...base, lines: [line(6000)], returnedAmount: 0 });
    expect(err).toMatch(/أكبر من الرصيد المتبقّي/);
  });

  it("counts earlier settlements against the ceiling", () => {
    expect(validateSettlement({ advanceAmount: 5000, alreadySettled: 4000, lines: [line(1500)], returnedAmount: 0 }))
      .toMatch(/أكبر من الرصيد/);
    expect(validateSettlement({ advanceAmount: 5000, alreadySettled: 4000, lines: [line(1000)], returnedAmount: 0 }))
      .toBeNull();
  });

  it("refuses an empty settlement and bad numbers", () => {
    expect(validateSettlement({ ...base, lines: [], returnedAmount: 0 })).toMatch(/أضف/);
    expect(validateSettlement({ ...base, lines: [line(0)], returnedAmount: 0 })).toMatch(/أكبر من صفر/);
    expect(validateSettlement({ ...base, lines: [line(-5)], returnedAmount: 0 })).toMatch(/أكبر من صفر/);
    expect(validateSettlement({ ...base, lines: [line(100, "")], returnedAmount: 0 })).toMatch(/حساب المصروف/);
    expect(validateSettlement({ ...base, lines: [line(100)], returnedAmount: -1 })).toMatch(/بالسالب/);
  });

  it("tolerates a half-piaster rounding crumb at the ceiling", () => {
    expect(validateSettlement({ ...base, lines: [line(5000.004)], returnedAmount: 0 })).toBeNull();
  });
});

describe("closing the advance", () => {
  it("closes when everything is accounted for", () => {
    expect(closesAdvance({ advanceAmount: 5000, alreadySettled: 0, lines: [line(4500)], returnedAmount: 500 })).toBe(true);
  });

  it("stays open while money is still out", () => {
    expect(closesAdvance({ advanceAmount: 5000, alreadySettled: 0, lines: [line(1000)], returnedAmount: 0 })).toBe(false);
  });
});

describe("journal entries", () => {
  it("issuing moves cash to the employee's custody account", () => {
    const lines = issueEntryLines("CUSTODY", "CASH", 5000, "عهدة");
    expect(lines).toEqual([
      { accountId: "CUSTODY", debit: 5000, credit: 0, description: "عهدة" },
      { accountId: "CASH", debit: 0, credit: 5000, description: "عهدة" },
    ]);
  });

  it("settling relieves custody by exactly what the expenses and returned cash take", () => {
    const lines = settlementEntryLines("CUSTODY", "CASH", [line(1200, "E1"), line(300, "E2")], 500, "تسوية");
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(debit).toBe(2000);
    expect(credit).toBe(2000);
    expect(lines.find((l) => l.accountId === "CUSTODY")?.credit).toBe(2000);
    expect(lines.find((l) => l.accountId === "CASH")?.debit).toBe(500);
  });

  it("omits the cash line when nothing was handed back", () => {
    const lines = settlementEntryLines("CUSTODY", "CASH", [line(1500, "E1")], 0, "تسوية");
    expect(lines.some((l) => l.accountId === "CASH")).toBe(false);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });
});
