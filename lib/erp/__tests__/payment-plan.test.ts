import { describe, it, expect } from "vitest";
import { planPayments, planSummary, daysOverdue, type PayableBill } from "@/lib/erp/payment-plan";

const on = new Date("2026-03-15T00:00:00Z");

const bill = (o: Partial<PayableBill> & { id: string }): PayableBill => ({
  number: `PI-${o.id}`, supplierId: "S1", supplierName: "مورّد",
  dueDate: "2026-03-10", outstanding: 1000, ...o,
});

describe("days overdue", () => {
  it("counts past due as positive and future as negative", () => {
    expect(daysOverdue("2026-03-10", on)).toBe(5);
    expect(daysOverdue("2026-03-20", on)).toBe(-5);
    expect(daysOverdue("2026-03-15", on)).toBe(0);
  });

  it("sends an undated bill to the back of the queue", () => {
    expect(daysOverdue(null, on)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("payment plan order", () => {
  it("pays the most overdue first", () => {
    const p = planPayments([
      bill({ id: "b", dueDate: "2026-03-14" }),
      bill({ id: "a", dueDate: "2026-01-01" }),
      bill({ id: "c", dueDate: "2026-04-01" }),
    ], 99999, on);
    expect(p.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves undated bills last", () => {
    const p = planPayments([
      bill({ id: "undated", dueDate: null }),
      bill({ id: "future", dueDate: "2026-12-01" }),
    ], 99999, on);
    expect(p.map((x) => x.id)).toEqual(["future", "undated"]);
  });

  it("walks the cash down and marks what it cannot reach", () => {
    const p = planPayments([
      bill({ id: "a", dueDate: "2026-01-01", outstanding: 600 }),
      bill({ id: "b", dueDate: "2026-02-01", outstanding: 600 }),
    ], 1000, on);
    expect(p[0].affordable).toBe(true);
    expect(p[0].cashAfter).toBe(400);
    expect(p[1].affordable).toBe(false);
    expect(p[1].cashAfter).toBe(400); // untouched — it was not paid
  });

  it("shows every bill, including the ones it cannot pay", () => {
    const p = planPayments([bill({ id: "big", outstanding: 5000 })], 100, on);
    expect(p).toHaveLength(1);
    expect(p[0].affordable).toBe(false);
  });
});

describe("early-payment discount", () => {
  it("values a discount still within reach", () => {
    const p = planPayments([bill({
      id: "d", invoiceDate: "2026-03-10", discountDays: 10, discountPercent: 2, outstanding: 1000,
    })], 99999, on);
    expect(p[0].discountValue).toBe(20);
    expect(p[0].discountDeadline?.toISOString().slice(0, 10)).toBe("2026-03-20");
  });

  it("values nothing once the window has closed", () => {
    const p = planPayments([bill({
      id: "d", invoiceDate: "2026-02-01", discountDays: 10, discountPercent: 2,
    })], 99999, on);
    expect(p[0].discountValue).toBeNull();
  });

  it("still counts on the deadline day itself", () => {
    const p = planPayments([bill({
      id: "d", invoiceDate: "2026-03-05", discountDays: 10, discountPercent: 5, outstanding: 200,
    })], 99999, on);
    expect(p[0].discountValue).toBe(10);
  });
});

describe("summary", () => {
  it("adds up what is owed, overdue, affordable and short", () => {
    const bills = [
      bill({ id: "a", dueDate: "2026-01-01", outstanding: 600 }),
      bill({ id: "b", dueDate: "2026-04-01", outstanding: 900 }),
    ];
    const s = planSummary(planPayments(bills, 1000, on), 1000);
    expect(s.total).toBe(1500);
    expect(s.overdue).toBe(600);
    expect(s.payable).toBe(600);
    expect(s.shortfall).toBe(500);
    expect(s.unaffordable).toBe(1);
  });
});
