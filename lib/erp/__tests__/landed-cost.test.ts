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
});
