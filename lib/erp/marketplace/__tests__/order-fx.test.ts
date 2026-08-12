import { describe, it, expect } from "vitest";
import { orderToBase, isForeign } from "../order-fx";
import type { MarketplaceOrder } from "../dto";

const order = (currency: string | undefined): MarketplaceOrder => ({
  externalId: "AE-1", date: "2026-08-12T00:00:00Z", status: "Shipped", currency,
  subtotal: 100, shippingTotal: 10, discount: 5, total: 105,
  lines: [{ code: "SKU1", qty: 2, unitPrice: 50, lineTotal: 100, shipping: 10 }],
});

describe("isForeign", () => {
  it("is false for base / absent, true for a different currency (case-insensitive)", () => {
    expect(isForeign({ currency: "EGP" }, "EGP")).toBe(false);
    expect(isForeign({ currency: "egp" }, "EGP")).toBe(false);
    expect(isForeign({ currency: undefined }, "EGP")).toBe(false);
    expect(isForeign({ currency: "AED" }, "EGP")).toBe(true);
  });
});

describe("orderToBase", () => {
  it("multiplies every money field by the rate and tags currency as base", () => {
    const b = orderToBase(order("AED"), 13, "EGP"); // 1 AED = 13 EGP
    expect(b.currency).toBe("EGP");
    expect(b.subtotal).toBe(1300);
    expect(b.shippingTotal).toBe(130);
    expect(b.discount).toBe(65);
    expect(b.total).toBe(1365);
    expect(b.lines[0]).toMatchObject({ unitPrice: 650, lineTotal: 1300, shipping: 130 });
  });
  it("rounds to 2 decimals and leaves qty/codes untouched", () => {
    const b = orderToBase(order("AED"), 0.335, "EGP");
    expect(b.total).toBe(35.18); // 105 * 0.335 = 35.175 → 35.18
    expect(b.lines[0].qty).toBe(2);
    expect(b.lines[0].code).toBe("SKU1");
  });
});
