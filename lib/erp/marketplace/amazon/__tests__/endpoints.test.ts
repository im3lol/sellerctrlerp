import { describe, it, expect } from "vitest";
import { listingToProduct } from "../listings";
import { toMarketplaceOrder } from "../orders";
import { summaryToInventory } from "../inventory";

// Pin the direct SP-API JSON → DTO mappings (verified against sample responses;
// the live shapes may need small tweaks on the first real sync).

describe("listingToProduct (searchListingsItems)", () => {
  it("maps sku/asin/name and price from offers", () => {
    const p = listingToProduct({ sku: "SKU1", summaries: [{ asin: "ASIN1", itemName: "Widget" }], offers: [{ price: { amount: "120.50" } }] });
    expect(p).toMatchObject({ code: "SKU1", altCode: "ASIN1", name: "Widget", sellPrice: 120.5 });
  });
  it("defaults price to 0 and skips a listing without a sku", () => {
    expect(listingToProduct({ summaries: [{ asin: "A" }] })).toBeNull();
    expect(listingToProduct({ sku: "S", summaries: [{}] })?.sellPrice).toBe(0);
  });
});

describe("toMarketplaceOrder (getOrders + getOrderItems)", () => {
  it("maps status, lines, unit price and totals", () => {
    const o = toMarketplaceOrder(
      { AmazonOrderId: "111-22", PurchaseDate: "2026-07-01T00:00:00Z", OrderStatus: "Shipped" },
      [{ SellerSKU: "SKU1", ASIN: "ASIN1", Title: "Widget", QuantityOrdered: 2, ItemPrice: { Amount: "100" }, ShippingPrice: { Amount: "5" } }],
    );
    expect(o).toMatchObject({ externalId: "111-22", status: "Shipped", subtotal: 100, shippingTotal: 5, total: 105 });
    expect(o.lines[0]).toMatchObject({ code: "SKU1", altCode: "ASIN1", qty: 2, unitPrice: 50, lineTotal: 100, shipping: 5 });
  });
  it("maps a non-shipped status to Pending", () => {
    expect(toMarketplaceOrder({ AmazonOrderId: "X", OrderStatus: "Unshipped" }, []).status).toBe("Pending");
  });
});

describe("summaryToInventory (getInventorySummaries)", () => {
  it("maps sku/name/quantity and skips rows without a sku", () => {
    expect(summaryToInventory({ sellerSku: "SKU1", productName: "Widget", totalQuantity: 7 })).toEqual({ code: "SKU1", title: "Widget", onHand: 7 });
    expect(summaryToInventory({ totalQuantity: 3 })).toBeNull();
  });
});
