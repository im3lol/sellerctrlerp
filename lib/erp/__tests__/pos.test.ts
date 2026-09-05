import { describe, it, expect } from "vitest";
import {
  cartTotals, paymentsTotal, changeDue, validatePayments, appliedPayments, reconcileShift,
  type Payment, type CartLine,
} from "@/lib/erp/pos";

const line = (quantity: number, unitPrice: number, discount = 0): CartLine =>
  ({ itemId: "i", quantity, unitPrice, discount });

const pay = (method: Payment["method"], amount: number): Payment => ({ method, amount });

describe("cart totals", () => {
  it("adds lines, takes discounts off, then applies tax to the net", () => {
    const t = cartTotals([line(2, 100), line(1, 50, 10)], 14, true);
    expect(t.subtotal).toBe(250);
    expect(t.discount).toBe(10);
    expect(t.net).toBe(240);
    expect(t.tax).toBe(33.6);
    expect(t.total).toBe(273.6);
  });

  it("leaves tax out when it does not apply", () => {
    expect(cartTotals([line(1, 100)], 14, false).total).toBe(100);
  });

  it("handles an empty cart", () => {
    expect(cartTotals([]).total).toBe(0);
  });
});

describe("payment split", () => {
  it("accepts an exact split across methods", () => {
    expect(validatePayments(300, [pay("CASH", 100), pay("CARD", 200)])).toBeNull();
  });

  it("refuses a sale that is short, naming what is left", () => {
    expect(validatePayments(300, [pay("CASH", 250)])).toMatch(/50\.00/);
  });

  it("allows cash over the total — that is change, not revenue", () => {
    expect(validatePayments(270, [pay("CASH", 300)])).toBeNull();
    expect(changeDue(270, [pay("CASH", 300)])).toBe(30);
  });

  it("refuses a card that overpays — nothing gives change on a card", () => {
    expect(validatePayments(270, [pay("CARD", 300)])).toMatch(/الفكة كاش/);
  });

  it("refuses zero, negative and empty payments", () => {
    expect(validatePayments(100, [])).toMatch(/طريقة دفع/);
    expect(validatePayments(100, [pay("CASH", 0)])).toMatch(/أكبر من صفر/);
    expect(validatePayments(0, [pay("CASH", 10)])).toMatch(/فاضية/);
  });

  it("tolerates a half-piastre rounding crumb", () => {
    expect(validatePayments(100, [pay("CASH", 99.997)])).toBeNull();
  });
});

describe("what the invoice records", () => {
  it("records the total, never the change", () => {
    const applied = appliedPayments(270, [pay("CASH", 300)]);
    expect(paymentsTotal(applied)).toBe(270);
  });

  it("keeps the card as tendered and trims only the cash", () => {
    const applied = appliedPayments(300, [pay("CARD", 200), pay("CASH", 150)]);
    expect(applied.find((p) => p.method === "CARD")?.amount).toBe(200);
    expect(applied.find((p) => p.method === "CASH")?.amount).toBe(100);
    expect(paymentsTotal(applied)).toBe(300);
  });

  it("drops the cash line entirely when the card covered everything", () => {
    const applied = appliedPayments(200, [pay("CARD", 200)]);
    expect(applied.some((p) => p.method === "CASH")).toBe(false);
  });
});

describe("shift reconciliation", () => {
  it("expects the float plus cash sales only — card money is not in the drawer", () => {
    const r = reconcileShift({
      openingFloat: 500,
      payments: [{ method: "CASH", amount: 1200 }, { method: "CARD", amount: 3000 }],
      countedCash: 1700,
    });
    expect(r.cashSales).toBe(1200);
    expect(r.expected).toBe(1700);
    expect(r.difference).toBe(0);
    expect(r.totalSales).toBe(4200);
  });

  it("reports a shortage as negative and a surplus as positive", () => {
    const short = reconcileShift({ openingFloat: 500, payments: [{ method: "CASH", amount: 1000 }], countedCash: 1460 });
    expect(short.difference).toBe(-40);
    const over = reconcileShift({ openingFloat: 500, payments: [{ method: "CASH", amount: 1000 }], countedCash: 1520 });
    expect(over.difference).toBe(20);
  });

  it("takes cash refunds back out of what should be there", () => {
    const r = reconcileShift({
      openingFloat: 500, payments: [{ method: "CASH", amount: 1000 }], refundsCash: 200, countedCash: 1300,
    });
    expect(r.expected).toBe(1300);
    expect(r.difference).toBe(0);
  });

  it("breaks the take down by method", () => {
    const r = reconcileShift({
      openingFloat: 0,
      payments: [{ method: "CASH", amount: 100 }, { method: "CARD", amount: 50 }, { method: "CASH", amount: 25 }],
      countedCash: 125,
    });
    expect(r.byMethod.CASH).toBe(125);
    expect(r.byMethod.CARD).toBe(50);
  });
});
