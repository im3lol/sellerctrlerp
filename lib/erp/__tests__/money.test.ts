import { describe, it, expect } from "vitest";
import { round2, round4, unitAllIn, receivedUnitCost } from "../money";

describe("round2", () => {
  it("rounds to 2 decimals", () => {
    expect(round2(1.005)).toBe(1.0); // JS float: 1.005*100 = 100.499… → 100
    expect(round2(2.345)).toBe(2.35);
    expect(round2(10)).toBe(10);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("round4", () => {
  it("rounds to 4 decimals", () => {
    expect(round4(1.23456)).toBe(1.2346);
    expect(round4(5)).toBe(5);
  });
});

describe("unitAllIn", () => {
  it("spreads the line's tax and discount over the pieces", () => {
    // 4 pieces at 100, freight 10/piece, 56 tax and 20 discount on the whole line,
    // 15/piece of posted import cost → 100 + 10 + (56−20)/4 + 15.
    expect(unitAllIn({
      quantity: 4, unitPrice: 100, shippingPerUnit: 10,
      taxAmount: 56, discountAmount: 20, landedPerUnit: 15,
    })).toBe(134);
  });

  it("is just the price when nothing else is loaded on", () => {
    expect(unitAllIn({ quantity: 3, unitPrice: 12.5 })).toBe(12.5);
  });

  it("does not divide by a zero quantity", () => {
    expect(unitAllIn({ quantity: 0, unitPrice: 50, taxAmount: 7 })).toBe(50);
  });
});

describe("receivedUnitCost", () => {
  it("spreads the order's line discount over the units", () => {
    // 4 at 100, 20 discount on the line, 10 freight each → 100 − 5 + 10.
    expect(receivedUnitCost({ quantity: 4, unitPrice: 100, discountAmount: 20, shippingPerUnit: 10 })).toBe(105);
  });

  it("leaves VAT out when it is recoverable", () => {
    // taxPerUnit is 0 for every receipt raised while the org reclaims purchase VAT.
    expect(receivedUnitCost({ quantity: 1, unitPrice: 100, discountAmount: 0, shippingPerUnit: 0, taxPerUnit: 0 })).toBe(100);
  });

  it("carries VAT into the cost when the org loads it onto the goods", () => {
    expect(receivedUnitCost({ quantity: 1, unitPrice: 100, discountAmount: 0, shippingPerUnit: 0, taxPerUnit: 14 })).toBe(114);
  });

  it("does not divide by a zero quantity", () => {
    expect(receivedUnitCost({ quantity: 0, unitPrice: 50, discountAmount: 30, shippingPerUnit: 2 })).toBe(52);
  });
});

// The rule the purchase-invoice posting has to obey, written down where it can fail
// loudly: whatever split of VAT is used, the three debits must equal the credit to the
// supplier. Get a sign or a term wrong and the DB's balanced-entry trigger rejects the
// posting at runtime — this catches it here instead.
describe("purchase-invoice posting identity", () => {
  const settle = (o: {
    quantity: number; unitPrice: number; discountAmount: number;
    shippingPerUnit: number; taxPerUnit: number; billedTax: number;
  }) => {
    const grni = round2(o.quantity * receivedUnitCost(o));
    const capTax = Math.min(round2(o.quantity * o.taxPerUnit), o.billedTax);
    const recTax = round2(o.billedTax - capTax);
    const net = round2(o.quantity * o.unitPrice + o.quantity * o.shippingPerUnit - o.discountAmount + capTax);
    const total = round2(o.quantity * o.unitPrice + o.quantity * o.shippingPerUnit - o.discountAmount + o.billedTax);
    return { grni, recTax, variance: round2(net - grni), total };
  };

  it("balances when VAT is recoverable", () => {
    const s = settle({ quantity: 4, unitPrice: 100, discountAmount: 20, shippingPerUnit: 10, taxPerUnit: 0, billedTax: 53.2 });
    expect(s.recTax).toBe(53.2);
    expect(round2(s.grni + s.variance + s.recTax)).toBe(s.total);
  });

  it("balances when VAT rides in the goods cost", () => {
    const s = settle({ quantity: 4, unitPrice: 100, discountAmount: 20, shippingPerUnit: 10, taxPerUnit: 13.3, billedTax: 53.2 });
    expect(s.recTax).toBe(0);
    expect(s.variance).toBe(0); // the receipt and the bill agree — no phantom revaluation
    expect(round2(s.grni + s.variance + s.recTax)).toBe(s.total);
  });

  it("still balances when the supplier billed less tax than the order assumed", () => {
    // The excess is a real cost correction: it lands in the variance, never as a
    // negative debit to the input-tax account.
    const s = settle({ quantity: 4, unitPrice: 100, discountAmount: 20, shippingPerUnit: 10, taxPerUnit: 13.3, billedTax: 20 });
    expect(s.recTax).toBe(0);
    expect(s.variance).toBeLessThan(0);
    expect(round2(s.grni + s.variance + s.recTax)).toBe(s.total);
  });
});
