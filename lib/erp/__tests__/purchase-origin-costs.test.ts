import { describe, expect, it } from "vitest";
import { allocateOriginCosts, allocateOriginShares, originDisplayLines, type OriginLine, type OriginCost } from "../purchase-origin-costs";
import { receivedUnitCost } from "../money";
const lines: OriginLine[] = [
  { itemId: "a", quantity: 2, unitPrice: 10, shippingPerUnit: 1, discountAmount: 0, taxAmount: 0, exempt: false, uomFactor: 1 },
  { itemId: "b", quantity: 1, unitPrice: 20, shippingPerUnit: 0, discountAmount: 0, taxAmount: 0, exempt: false, uomFactor: 1 },
];
const cost = (patch: Partial<OriginCost> = {}): OriginCost => ({ kind: "DOMESTIC_FREIGHT", amount: 12, allocationMethod: "VALUE", description: "", manual: {}, ...patch });
describe("purchase order origin costs", () => {
  it("keeps shipping, discount, tax and other charges in their own cells", () => {
    const costs = [cost(), cost({ kind: "DISCOUNT", amount: 4 }), cost({ kind: "MARKETPLACE_TAX", amount: 6 }), cost({ kind: "PREP", amount: 2 })];
    const [share] = allocateOriginShares(lines, costs);
    expect(share).toEqual({ shipping: 6, discount: 2, tax: 3, other: 1 });
    const shown = originDisplayLines({ lines, costs });
    expect(shown[0]).toMatchObject({ unitPrice: 10, shippingPerUnit: 4, discountAmount: 2, taxAmount: 3, otherAmount: 1, totalAmount: 30 });
    expect(shown.reduce((s, l) => s + l.totalAmount, 0)).toBe(58);
    expect(allocateOriginCosts(lines, costs, 1).reduce((s, l) => s + l.totalAmount, 0)).toBe(58);
  });
  it("reapplying a distribution replaces it, without compounding the original cells", () => {
    const first = originDisplayLines({ lines, costs: [cost()] });
    const second = originDisplayLines({ lines, costs: [cost()] });
    expect(second).toEqual(first);
    expect(originDisplayLines({ lines, costs: [] })[0].shippingPerUnit).toBe(1);
    expect(lines[0].shippingPerUnit).toBe(1);
  });
  it("allocates by value and converts currency once", () => {
    const result = allocateOriginCosts(lines, [cost()], 50);
    expect(result.map(l => l.unitPrice)).toEqual([650, 1300]);
    expect(result.reduce((s, l) => s + l.totalAmount, 0)).toBe(2700);
  });
  it("allocates by quantity", () => {
    expect(allocateOriginCosts(lines, [cost({ allocationMethod: "QUANTITY" })], 1).map(l => l.unitPrice)).toEqual([14, 24]);
  });
  it("manual allocations survive reorder", () => {
    const c = cost({ allocationMethod: "MANUAL", manual: { a: 2, b: 10 } });
    expect(allocateOriginCosts([...lines].reverse(), [c], 1).map(l => l.unitPrice)).toEqual([30, 11]);
  });
  it("rejects incomplete manual allocation and stale item amounts", () => {
    expect(() => allocateOriginCosts(lines, [cost({ allocationMethod: "MANUAL", manual: { a: 2 } })], 1)).toThrow();
    expect(() => allocateOriginCosts(lines, [cost({ allocationMethod: "MANUAL", manual: { a: 12, gone: 1 } })], 1)).toThrow();
  });
  it("discount reduces cost, but cannot make stock negative", () => {
    expect(allocateOriginCosts(lines, [cost({ kind: "DISCOUNT" })], 1).map(l => l.unitPrice)).toEqual([7, 14]);
    expect(() => allocateOriginCosts(lines, [cost({ kind: "DISCOUNT", amount: 100 })], 1)).toThrow();
  });
  it("reloading original snapshot never compounds allocation", () => {
    const snapshot = JSON.parse(JSON.stringify({ lines, costs: [cost()] }));
    expect(allocateOriginCosts(snapshot.lines, snapshot.costs, 1)).toEqual(allocateOriginCosts(lines, [cost()], 1));
    expect(lines[0].unitPrice).toBe(10);
  });
  it("partial receipt inherits per-unit cost even when receipt freight changes", () => {
    const [l] = allocateOriginCosts(lines, [cost()], 1);
    const receiptUnit = receivedUnitCost({ ...l, shippingPerUnit: 0 });
    expect(receiptUnit).toBe(13);
    expect(receiptUnit * 1 + receiptUnit * 1).toBe(26);
  });
  it("zero-priced items require quantity/manual distribution", () => {
    const free = lines.map(l => ({ ...l, unitPrice: 0 }));
    expect(() => allocateOriginCosts(free, [cost()], 1)).toThrow();
    expect(allocateOriginCosts(free, [cost({ allocationMethod: "QUANTITY" })], 1)[0].unitPrice).toBe(4);
  });
});
