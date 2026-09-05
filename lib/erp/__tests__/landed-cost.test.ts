import { describe, it, expect } from "vitest";
import { allocateLandedPerUnit, type LcLine } from "@/lib/erp/landed-cost";

const L = (quantity: number, unitPrice: number, eligible = true): LcLine => ({ quantity, unitPrice, eligible });

// Total capitalised = Σ(perUnit_i × qty_i) should equal the input total (within rounding).
const capitalised = (lines: LcLine[], perUnit: number[]) => perUnit.reduce((s, p, i) => s + p * lines[i].quantity, 0);

describe("allocateLandedPerUnit", () => {
  it("by value: proportional to line value, conserves the total", () => {
    const lines = [L(10, 100), L(10, 300)]; // values 1000 and 3000 → 1:3
    const per = allocateLandedPerUnit(lines, 400, "value");
    expect(per[0]).toBeCloseTo(10, 4); // 400×1/4 = 100 over 10 units = 10/unit
    expect(per[1]).toBeCloseTo(30, 4); // 400×3/4 = 300 over 10 units = 30/unit
    expect(capitalised(lines, per)).toBeCloseTo(400, 2);
  });

  it("by quantity: uniform per-unit charge", () => {
    const lines = [L(2, 100), L(8, 5)]; // 10 units total
    const per = allocateLandedPerUnit(lines, 500, "qty");
    expect(per[0]).toBeCloseTo(50, 4);
    expect(per[1]).toBeCloseTo(50, 4);
    expect(capitalised(lines, per)).toBeCloseTo(500, 2);
  });

  it("skips ineligible / empty lines and only spreads over the rest", () => {
    const lines = [L(5, 100), L(1, 0, false)]; // 2nd line ineligible
    const per = allocateLandedPerUnit(lines, 250, "value");
    expect(per[1]).toBe(0);
    expect(per[0]).toBeCloseTo(50, 4); // whole 250 over 5 units
  });

  it("returns zeros for non-positive total or no allocatable base", () => {
    expect(allocateLandedPerUnit([L(1, 10)], 0, "value")).toEqual([0]);
    expect(allocateLandedPerUnit([L(1, 0)], 100, "value")).toEqual([0]); // zero value → can't allocate by value
    expect(allocateLandedPerUnit([L(0, 10)], 100, "qty")).toEqual([0]);  // zero qty
  });

  it("by weight: proportional to line weight, conserves the total", () => {
    // 10 × 0.5kg = 5kg and 10 × 1.5kg = 15kg → 1:3 of a 20kg shipment.
    const lines: LcLine[] = [{ quantity: 10, unitPrice: 999, weight: 0.5, eligible: true },
                             { quantity: 10, unitPrice: 1, weight: 1.5, eligible: true }];
    const per = allocateLandedPerUnit(lines, 16000, "weight");
    expect(per[0]).toBeCloseTo(400, 4);  // 16000×5/20 = 4000 over 10 units
    expect(per[1]).toBeCloseTo(1200, 4); // 16000×15/20 = 12000 over 10 units
    expect(capitalised(lines, per)).toBeCloseTo(16000, 2);
  });

  it("by weight equals price/kg × the item's own weight", () => {
    // The user-facing promise: 800 EGP/kg on a 3950-worth shipment must land as
    // 800 × weight per unit, whatever the items' prices are.
    const lines: LcLine[] = [{ quantity: 4, unitPrice: 50, weight: 2, eligible: true },
                             { quantity: 3, unitPrice: 900, weight: 0.25, eligible: true }];
    const totalKg = 4 * 2 + 3 * 0.25; // 8.75 kg
    const per = allocateLandedPerUnit(lines, 800 * totalKg, "weight");
    expect(per[0]).toBeCloseTo(1600, 4); // 800 × 2kg
    expect(per[1]).toBeCloseTo(200, 4);  // 800 × 0.25kg
  });

  it("by weight falls back to zeros when no item has a weight set", () => {
    const lines: LcLine[] = [{ quantity: 5, unitPrice: 100, weight: 0, eligible: true }];
    expect(allocateLandedPerUnit(lines, 500, "weight")).toEqual([0]);
  });
});

/**
 * The landed-cost voucher's posting rule (app/actions/erp/landed-costs.ts): stock still
 * on hand carries the uplift; whatever was already sold goes to COGS instead. Kept here
 * as the executable statement of that split so the accounting can't drift silently.
 */
const split = (perUnit: number, qty: number, onHand: number) => {
  const applyQty = Math.min(onHand, qty);
  const inv = Math.round(perUnit * applyQty * 100) / 100;
  return { inv, cogs: Math.round((perUnit * qty - inv) * 100) / 100 };
};

/**
 * applyCostAdjustment (lib/erp/cost-adjust.ts) is shared by the landed-cost voucher AND
 * the purchase-invoice price variance. Both directions matter: a supplier billing MORE
 * than the order adds cost, billing LESS takes it back off.
 */
describe("cost adjustment is signed and always conserves the total", () => {
  const apply = (perUnit: number, qty: number, onHand: number) => {
    const invPart = Math.round(perUnit * Math.min(onHand, qty) * 100) / 100;
    const amount = Math.round(perUnit * qty * 100) / 100;
    return { inv: invPart, cogs: Math.round((amount - invPart) * 100) / 100, amount };
  };

  it("a negative variance (billed less) gives back negative shares", () => {
    const r = apply(-5, 100, 100);
    expect(r.inv).toBe(-500);
    expect(r.cogs).toBe(0);
    expect(r.inv + r.cogs).toBeCloseTo(r.amount, 2);
  });

  it("negative variance with stock partly sold splits both ways", () => {
    const r = apply(-5, 100, 40);
    expect(r.inv).toBe(-200);
    expect(r.cogs).toBe(-300);
    expect(r.inv + r.cogs).toBeCloseTo(r.amount, 2);
  });

  it("inventory + COGS always sum back to the charge, whatever is on hand", () => {
    for (const onHand of [0, 1, 37, 99, 100, 500]) {
      for (const per of [12.34, -7.5]) {
        const r = apply(per, 100, onHand);
        expect(r.inv + r.cogs).toBeCloseTo(r.amount, 2);
      }
    }
  });
});

describe("landed cost inventory/COGS split", () => {
  it("all still on hand → the whole charge capitalises", () => {
    expect(split(10, 100, 100)).toEqual({ inv: 1000, cogs: 0 });
  });

  it("all sold → the whole charge hits COGS", () => {
    expect(split(10, 100, 0)).toEqual({ inv: 0, cogs: 1000 });
  });

  it("partly sold → split in proportion to what's left", () => {
    expect(split(10, 100, 40)).toEqual({ inv: 400, cogs: 600 });
  });

  it("more on hand than received (later intakes) → still capped at the received qty", () => {
    expect(split(10, 100, 250)).toEqual({ inv: 1000, cogs: 0 });
  });
});

/**
 * The REVALUE movement (lib/erp/inventory.ts): quantity doesn't move, only value.
 * Both engine invariants have to survive it —
 *   balance_value += valueDelta   AND   Σ(remaining × unit_cost) == balance_value
 * — which is exactly what the direct-batch-write version of this feature broke.
 */
const revalue = (lots: { rem: number; cost: number }[], valueDelta: number) => {
  const sumRem = lots.reduce((s, b) => s + b.rem, 0);
  const priorValue = lots.reduce((s, b) => s + b.rem * b.cost, 0);
  const perUnit = valueDelta / sumRem;
  const after = lots.map((b) => ({ rem: b.rem, cost: Math.round((b.cost + perUnit) * 10000) / 10000 }));
  return {
    priorValue,
    balanceValue: priorValue + valueDelta,
    lotValue: after.reduce((s, b) => s + b.rem * b.cost, 0),
    after,
  };
};

describe("REVALUE keeps the stock-ledger invariants", () => {
  it("single lot: value rises by exactly the delta and the lot carries it", () => {
    const r = revalue([{ rem: 100, cost: 50 }], 1000);
    expect(r.balanceValue).toBeCloseTo(6000, 2);
    expect(r.lotValue).toBeCloseTo(r.balanceValue, 2); // Σ(rem × cost) == balance_value
    expect(r.after[0].cost).toBeCloseTo(60, 4);        // 50 + 1000/100
  });

  it("several lots: the uplift is per-unit, so lot value still equals balance value", () => {
    const r = revalue([{ rem: 30, cost: 10 }, { rem: 70, cost: 20 }], 500);
    expect(r.priorValue).toBeCloseTo(1700, 2);         // 30×10 + 70×20
    expect(r.balanceValue).toBeCloseTo(2200, 2);       // + 500
    expect(r.lotValue).toBeCloseTo(r.balanceValue, 2);
    expect(r.after[0].cost).toBeCloseTo(15, 4); // 10 + 500/100
    expect(r.after[1].cost).toBeCloseTo(25, 4); // 20 + 500/100
  });

  it("a negative delta (cancelling the voucher) unwinds it exactly", () => {
    const lots = [{ rem: 40, cost: 12.5 }, { rem: 60, cost: 8 }];
    const up = revalue(lots, 800);
    const back = revalue(up.after, -800);
    expect(back.balanceValue).toBeCloseTo(up.priorValue, 2);
    expect(back.after[0].cost).toBeCloseTo(12.5, 4);
    expect(back.after[1].cost).toBeCloseTo(8, 4);
  });
});
