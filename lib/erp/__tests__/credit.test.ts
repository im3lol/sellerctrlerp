import { describe, it, expect } from "vitest";
import { creditVerdict, creditExposure, creditError } from "@/lib/erp/credit";

const base = { balance: 0, creditLimit: 10000, openOrders: 0, orderTotal: 0 };

describe("credit exposure", () => {
  it("counts confirmed-but-uninvoiced orders, not just the posted balance", () => {
    expect(creditExposure({ balance: 4000, openOrders: 3000, orderTotal: 1000 })).toBe(8000);
  });
});

describe("credit verdict", () => {
  it("passes inside the limit", () => {
    expect(creditVerdict({ ...base, balance: 6000, orderTotal: 3000 }).ok).toBe(true);
  });

  it("passes exactly at the limit", () => {
    expect(creditVerdict({ ...base, balance: 7000, orderTotal: 3000 }).ok).toBe(true);
  });

  it("blocks past the limit and reports by how much", () => {
    const v = creditVerdict({ ...base, balance: 8000, orderTotal: 3000 });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.exposure).toBe(11000);
      expect(v.excess).toBe(1000);
    }
  });

  it("blocks on open orders alone — the case an invoice-time check misses", () => {
    // Nothing invoiced yet, but four confirmed orders already committed the whole limit.
    const v = creditVerdict({ ...base, balance: 0, openOrders: 9500, orderTotal: 1000 });
    expect(v.ok).toBe(false);
  });

  it("treats a zero or missing limit as unlimited", () => {
    expect(creditVerdict({ ...base, creditLimit: 0, balance: 999999, orderTotal: 5000 }).ok).toBe(true);
    expect(creditVerdict({ ...base, creditLimit: -1, orderTotal: 5000 }).ok).toBe(true);
  });

  it("does not trip on a rounding crumb at the limit", () => {
    expect(creditVerdict({ ...base, balance: 10000.0000001, orderTotal: 0 }).ok).toBe(true);
  });
});

describe("refusal message", () => {
  it("names the customer and both numbers", () => {
    const v = creditVerdict({ ...base, balance: 8000, orderTotal: 3000 });
    if (v.ok) throw new Error("expected a refusal");
    const msg = creditError("شركة النور", v);
    expect(msg).toContain("شركة النور");
    expect(msg).toContain("11,000.00");
    expect(msg).toContain("10,000.00");
    expect(msg).toContain("1,000.00");
  });
});
