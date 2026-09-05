import { describe, it, expect } from "vitest";
import { validateDecision, decisionEffect, inspectionStats } from "@/lib/erp/quality";

describe("pass/fail split", () => {
  it("accepts a split that adds up", () => {
    expect(validateDecision({ quantity: 100, passedQty: 90, failedQty: 10 })).toBeNull();
    expect(validateDecision({ quantity: 100, passedQty: 100, failedQty: 0 })).toBeNull();
    expect(validateDecision({ quantity: 100, passedQty: 0, failedQty: 100 })).toBeNull();
  });

  it("refuses a split that leaves units unaccounted for — they would sit in quarantine forever", () => {
    const err = validateDecision({ quantity: 100, passedQty: 90, failedQty: 8 });
    expect(err).toMatch(/فاضل 2/);
  });

  it("refuses deciding on more than arrived", () => {
    expect(validateDecision({ quantity: 100, passedQty: 95, failedQty: 10 })).toMatch(/أكبر من الكمية/);
  });

  it("refuses a negative quantity", () => {
    expect(validateDecision({ quantity: 100, passedQty: -1, failedQty: 101 })).toMatch(/بالسالب/);
  });

  it("names the whole quantity as undecided when nothing was entered", () => {
    // Deciding nothing is the same failure as deciding part — and saying "100 left
    // undecided" is more use than "make a decision".
    expect(validateDecision({ quantity: 100, passedQty: 0, failedQty: 0 })).toMatch(/فاضل 100/);
  });

  it("refuses a row with nothing to inspect", () => {
    expect(validateDecision({ quantity: 0, passedQty: 0, failedQty: 0 })).toMatch(/حدّد/);
  });

  it("tolerates a rounding crumb on a fractional quantity", () => {
    expect(validateDecision({ quantity: 10.5, passedQty: 10.4999999, failedQty: 0 })).toBeNull();
  });
});

describe("what a decision moves", () => {
  it("releases the passed quantity and holds the failed", () => {
    expect(decisionEffect({ quantity: 100, passedQty: 90, failedQty: 10 })).toEqual({ release: 90, hold: 10 });
  });

  it("releases nothing when everything failed", () => {
    expect(decisionEffect({ quantity: 100, passedQty: 0, failedQty: 100 })).toEqual({ release: 0, hold: 100 });
  });
});

describe("queue stats", () => {
  const row = (status: string, quantity: number, passedQty = 0, failedQty = 0) =>
    ({ status, quantity, passedQty, failedQty });

  it("counts what is waiting and the fail rate of what was decided", () => {
    const s = inspectionStats([
      row("PENDING", 50),
      row("PENDING", 30),
      row("DECIDED", 100, 90, 10),
      row("DECIDED", 100, 100, 0),
    ]);
    expect(s.pending).toBe(2);
    expect(s.pendingQty).toBe(80);
    expect(s.decided).toBe(2);
    expect(s.failRate).toBe(5);
  });

  it("has no fail rate before anything is decided", () => {
    expect(inspectionStats([row("PENDING", 10)]).failRate).toBeNull();
  });
});
