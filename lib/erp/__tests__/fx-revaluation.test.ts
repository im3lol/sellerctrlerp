import { describe, it, expect } from "vitest";
import { revalueOpenBalances, type InvRow } from "../fx-revaluation";

// InvRow amounts: totalAmount/balanceDue are BASE (invoice-rate) values; foreignAmount is
// the invoice-currency total. foreignRemaining = foreign * balanceDue/total, revalued at
// the current rate, gain = revalued − book for AR and the negative of that for AP.
const ar = (currencyCode: string, foreign: number, total: number, balanceDue: number): InvRow =>
  ({ currencyCode, foreignAmount: String(foreign), totalAmount: String(total), balanceDue: String(balanceDue) });
const ap = ar; // same shape; kind is decided by which list it goes in

describe("revalueOpenBalances", () => {
  it("AR gains when the base value rises (rate up)", () => {
    // 100 USD booked at 30 → book 3000; current rate 32 → revalued 3200.
    const r = revalueOpenBalances([ar("USD", 100, 3000, 3000)], [], new Map([["USD", 32]]));
    expect(r.rows[0]).toMatchObject({ kind: "AR", foreignRemaining: 100, book: 3000, revalued: 3200, gain: 200 });
    expect(r.netGain).toBe(200);
    expect(r.arAdj).toBe(200);
  });

  it("AP is a loss when the base value rises (you owe more base)", () => {
    const r = revalueOpenBalances([], [ap("USD", 100, 3000, 3000)], new Map([["USD", 32]]));
    expect(r.rows[0]).toMatchObject({ kind: "AP", revalued: 3200, gain: -200 });
    expect(r.netGain).toBe(-200);
    expect(r.apAdj).toBe(200); // base value of the payable rose by 200
  });

  it("passes a currency with no current rate through un-revalued (0 gain)", () => {
    const r = revalueOpenBalances([ar("EUR", 50, 1500, 1500)], [], new Map());
    expect(r.rows[0]).toMatchObject({ book: 1500, revalued: 1500, gain: 0 });
    expect(r.netGain).toBe(0);
  });

  it("revalues only the proportional remaining balance on a part-paid invoice", () => {
    // 100 USD, total 3000, half paid → balanceDue 1500 → foreignRemaining 50; at 32 → 1600.
    const r = revalueOpenBalances([ar("USD", 100, 3000, 1500)], [], new Map([["USD", 32]]));
    expect(r.rows[0]).toMatchObject({ foreignRemaining: 50, book: 1500, revalued: 1600, gain: 100 });
  });

  it("nets AR gain against AP loss across currencies", () => {
    const r = revalueOpenBalances(
      [ar("USD", 100, 3000, 3000)],          // +200 AR gain at 32
      [ap("USD", 100, 3000, 3000)],          // -200 AP loss at 32
      new Map([["USD", 32]]),
    );
    expect(r.netGain).toBe(0);
  });

  it("ignores zero-total rows (no divide-by-zero)", () => {
    const r = revalueOpenBalances([ar("USD", 0, 0, 0)], [], new Map([["USD", 32]]));
    expect(r.rows).toHaveLength(0);
    expect(r.netGain).toBe(0);
  });
});
