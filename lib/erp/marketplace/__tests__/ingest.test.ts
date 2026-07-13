import { describe, it, expect } from "vitest";
import { classifyOrders } from "../classify";
import type { MarketplaceOrder } from "../dto";

const order = (externalId: string, status: string, codes: string[]): MarketplaceOrder => ({
  externalId, date: "2026-07-01", status,
  subtotal: 100, shippingTotal: 0, total: 100,
  lines: codes.map((code) => ({ code, altCode: code + "-ALT", name: code, qty: 1, unitPrice: 100, lineTotal: 100, shipping: 0 })),
});

// Resolver: any code starting with "KNOWN" matches; altCode "ALT" matches too.
const resolve = (code: string, altCode?: string) => {
  for (const c of [code, altCode]) if (c?.startsWith("KNOWN")) return { itemId: "item_" + c, itemName: c };
  return { itemId: null, itemName: null };
};

describe("classifyOrders routing", () => {
  it("routes a new fully-matched order to toCreate", () => {
    const r = classifyOrders([order("A1", "Pending", ["KNOWN1"])], resolve, new Map());
    expect(r.toCreate).toHaveLength(1);
    expect(r.blocked).toHaveLength(0);
  });

  it("blocks an order with an unmatched line and reports the code", () => {
    const r = classifyOrders([order("A2", "Pending", ["KNOWN1", "MYSTERY"])], resolve, new Map());
    expect(r.blocked).toHaveLength(1);
    expect(r.unmatched.map((u) => u.code)).toContain("MYSTERY");
  });

  it("treats an already-imported order as a duplicate when not a shipped transition", () => {
    const existing = new Map([["A3", { id: "so_3", status: "DRAFT" }]]);
    const r = classifyOrders([order("A3", "Pending", ["KNOWN1"])], resolve, existing);
    expect(r.duplicates).toHaveLength(1);
    expect(r.transitions).toHaveLength(0);
  });

  it("transitions an existing DRAFT order that is now Shipped + fully matched", () => {
    const existing = new Map([["A4", { id: "so_4", status: "DRAFT" }]]);
    const r = classifyOrders([order("A4", "Shipped", ["KNOWN1"])], resolve, existing);
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions[0].existingId).toBe("so_4");
  });

  it("does not transition an existing order that is already DELIVERED", () => {
    const existing = new Map([["A5", { id: "so_5", status: "DELIVERED" }]]);
    const r = classifyOrders([order("A5", "Shipped", ["KNOWN1"])], resolve, existing);
    expect(r.duplicates).toHaveLength(1);
    expect(r.transitions).toHaveLength(0);
  });

  it("matches on altCode when the primary code is unknown", () => {
    // code unknown, but altCode starts with KNOWN → matched
    const o: MarketplaceOrder = { ...order("A6", "Pending", []), lines: [{ code: "X", altCode: "KNOWN9", name: "x", qty: 1, unitPrice: 1, lineTotal: 1, shipping: 0 }] };
    const r = classifyOrders([o], resolve, new Map());
    expect(r.toCreate).toHaveLength(1);
  });
});
