import { describe, it, expect } from "vitest";
import { listingToProduct, mergeProducts } from "../listings";
import { toMarketplaceOrder } from "../orders";
import { summaryToInventory, summaryToDetail } from "../inventory";
import { parseListingsReport } from "../reports";

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
  it("subtracts item + shipping promotions from the total", () => {
    // 1025 item + 20 shipping − 20 free-shipping promo = 1025 (matches Seller Central).
    const o = toMarketplaceOrder(
      { AmazonOrderId: "P-1", OrderStatus: "Shipped" },
      [{ SellerSKU: "SKU1", QuantityOrdered: 1, ItemPrice: { Amount: "1025" }, ShippingPrice: { Amount: "20" }, ShipPromotionDiscount: { Amount: "20" } }],
    );
    expect(o).toMatchObject({ subtotal: 1025, shippingTotal: 20, discount: 20, total: 1025 });
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

describe("parseListingsReport (GET_MERCHANT_LISTINGS_ALL_DATA TSV)", () => {
  // Columns keyed by header name (order varies by marketplace) — put price before name.
  const tsv = [
    "seller-sku\tprice\titem-name\tasin1\tquantity\tstatus",
    "SKU-1\t149.99\tWidget Red\tB00ABC123\t5\tActive",
    "SKU-2\t\tمنتج بلا سعر\tB00XYZ999\t0\tActive",
    "\t10\tno sku dropped\tB000\t1\tActive",
  ].join("\n");
  it("maps sku/asin/name/price by header, defaults price to 0, skips rows without a sku", () => {
    const rows = parseListingsReport(tsv);
    expect(rows).toHaveLength(2); // the no-sku row is dropped
    expect(rows[0]).toEqual({ code: "SKU-1", altCode: "B00ABC123", name: "Widget Red", sellPrice: 149.99 });
    expect(rows[1]).toMatchObject({ code: "SKU-2", altCode: "B00XYZ999", name: "منتج بلا سعر", sellPrice: 0 });
  });
  it("returns [] when the header lacks seller-sku", () => {
    expect(parseListingsReport("foo\tbar\nx\ty")).toEqual([]);
  });
});

describe("summaryToDetail (getInventorySummaries details=true)", () => {
  it("flattens the full inventoryDetails breakdown, defaulting missing fields to 0", () => {
    const d = summaryToDetail({
      sellerSku: "SKU-1", asin: "B00X", fnSku: "X001", productName: "Widget", totalQuantity: 100,
      inventoryDetails: {
        fulfillableQuantity: 90, inboundReceivingQuantity: 2,
        reservedQuantity: { totalReservedQuantity: 5, pendingCustomerOrderQuantity: 5 },
        unfulfillableQuantity: { totalUnfulfillableQuantity: 3, warehouseDamagedQuantity: 3 },
        researchingQuantity: { totalResearchingQuantity: 0 },
      },
    });
    expect(d).toMatchObject({
      code: "SKU-1", asin: "B00X", fnsku: "X001", total: 100, fulfillable: 90,
      inboundReceiving: 2, reservedTotal: 5, reservedCustomerOrder: 5,
      unfulfillableTotal: 3, warehouseDamaged: 3, customerDamaged: 0, researching: 0,
    });
  });
  it("skips a row without a sku and tolerates a missing inventoryDetails", () => {
    expect(summaryToDetail({ totalQuantity: 5 })).toBeNull();
    expect(summaryToDetail({ sellerSku: "S", totalQuantity: 7 })).toMatchObject({ code: "S", total: 7, fulfillable: 0 });
  });
});

describe("mergeProducts (full FBA catalog ⊕ priced listings)", () => {
  const full = [
    { code: "A", altCode: "ASIN_A", name: "A", sellPrice: 0 },
    { code: "B", altCode: "ASIN_B", name: "B", sellPrice: 0 },
  ];
  const priced = [
    { code: "A", altCode: "ASIN_A", name: "A", sellPrice: 120 }, // overlays price onto A
    { code: "C", altCode: "ASIN_C", name: "C (FBM)", sellPrice: 50 }, // listings-only → still kept
  ];
  it("keeps the full set, overlays price, and includes listings-only SKUs", () => {
    const m = mergeProducts(full, priced);
    expect(m).toHaveLength(3); // A, B, C — no dupes
    expect(m.find((p) => p.code === "A")?.sellPrice).toBe(120); // priced from listings
    expect(m.find((p) => p.code === "B")?.sellPrice).toBe(0); // inventory-only, no price
    expect(m.find((p) => p.code === "C")?.name).toBe("C (FBM)"); // listings-only survives
  });
});
