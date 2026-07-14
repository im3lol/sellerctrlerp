import { describe, it, expect } from "vitest";
import { classifyOrders, classifyProducts } from "../classify";
import type { MarketplaceOrder, MarketplaceProduct } from "../dto";

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

  it("routes a cancelled order that exists to toCancel", () => {
    const existing = new Map([["C1", { id: "so_c1", status: "CONFIRMED" }]]);
    const r = classifyOrders([order("C1", "Canceled", [])], resolve, existing);
    expect(r.toCancel).toHaveLength(1);
    expect(r.toCancel[0].existingId).toBe("so_c1");
  });

  it("ignores a cancellation for an unknown order (no-op)", () => {
    const r = classifyOrders([order("C2", "Canceled", [])], resolve, new Map());
    expect(r.toCancel).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
  });

  it("does not re-cancel an order already CANCELLED", () => {
    const existing = new Map([["C3", { id: "so_c3", status: "CANCELLED" }]]);
    const r = classifyOrders([order("C3", "Canceled", [])], resolve, existing);
    expect(r.toCancel).toHaveLength(0);
    expect(r.duplicates).toHaveLength(1);
  });
});

const product = (sku: string, asin?: string): MarketplaceProduct => ({ code: sku, altCode: asin, name: sku, sellPrice: 10 });

describe("classifyProducts — ASIN-required linking", () => {
  // Item "it_1" carries ASIN "B001" (normalized). "SKU-OLD" is an already-known code.
  const byAsin = new Map([["B001", "it_1"]]);
  const known = new Set(["B001", "SKUOLD"]);

  it("link mode matches only via an existing ASIN item_code, attaching a new SKU", () => {
    const p = classifyProducts([product("SKU-NEW", "B001")], byAsin, known, "link");
    expect(p.toLink).toEqual([{ itemId: "it_1", sku: "SKU-NEW" }]);
    expect(p.toCreate).toHaveLength(0);
    expect(p.skippedUnmatched).toBe(0);
  });

  it("link mode skips a listing whose ASIN is not an existing item_code", () => {
    const p = classifyProducts([product("SKU-X", "B999")], byAsin, known, "link");
    expect(p.skippedUnmatched).toBe(1);
    expect(p.toLink).toHaveLength(0);
    expect(p.toCreate).toHaveLength(0);
  });

  it("link mode skips a listing with no ASIN at all", () => {
    const p = classifyProducts([product("SKU-NOASIN")], byAsin, known, "link");
    expect(p.skippedUnmatched).toBe(1);
  });

  it("does NOT link by internal/SKU code — only ASIN counts", () => {
    // SKU-OLD is a known code but not an ASIN → still unmatched in link mode
    const p = classifyProducts([product("SKU-OLD", "B999")], byAsin, known, "link");
    expect(p.skippedUnmatched).toBe(1);
    expect(p.toLink).toHaveLength(0);
  });

  it("create mode creates a full item for an unmatched listing", () => {
    const p = classifyProducts([product("SKU-X", "B999")], byAsin, known, "create");
    expect(p.toCreate).toHaveLength(1);
    expect(p.skippedUnmatched).toBe(0);
  });

  it("counts an already-fully-linked listing as alreadyLinked", () => {
    // ASIN matches AND its SKU is already known → nothing to write
    const p = classifyProducts([product("SKU-OLD", "B001")], byAsin, known, "create");
    expect(p.alreadyLinked).toBe(1);
    expect(p.toLink).toHaveLength(0);
  });
});
