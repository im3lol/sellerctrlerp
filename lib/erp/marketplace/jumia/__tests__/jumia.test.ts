import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { signedQuery, commonParams } from "../constants";
import { productToProduct, productToInventory } from "../products";
import { orderToDto } from "../orders";

describe("jumia signing", () => {
  it("commonParams: carries the required SellerCenter fields", () => {
    const p = commonParams("GetOrders", "seller@x.com", new Date("2026-08-01T00:00:00Z"));
    expect(p).toMatchObject({ Action: "GetOrders", Format: "JSON", UserID: "seller@x.com", Version: "1.0", Timestamp: "2026-08-01T00:00:00.000Z" });
  });

  it("signedQuery: sorts params, HMAC-SHA256(hex) with the API key, appends Signature", () => {
    const params = { Action: "GetOrders", UserID: "seller@x.com", Timestamp: "2026-08-01T00:00:00.000Z", Format: "JSON", Version: "1.0" };
    const apiKey = "secret_key";
    // Recompute the expected signature over the sorted, RFC-3986-encoded base string.
    const base = "Action=GetOrders&Format=JSON&Timestamp=2026-08-01T00%3A00%3A00.000Z&UserID=seller%40x.com&Version=1.0";
    const expected = createHmac("sha256", apiKey).update(base).digest("hex");
    const qs = signedQuery(params, apiKey);
    expect(qs).toBe(`${base}&Signature=${expected}`);
    expect(qs.startsWith("Action=GetOrders&Format=JSON")).toBe(true); // sorted
  });

  it("signedQuery: excludes any pre-existing Signature from the signed base", () => {
    const a = signedQuery({ Action: "GetProducts", UserID: "u" }, "k");
    const b = signedQuery({ Action: "GetProducts", UserID: "u", Signature: "stale" }, "k");
    expect(a).toBe(b);
  });
});

describe("jumia mappers", () => {
  it("productToProduct + productToInventory", () => {
    const p = { SellerSku: "SKU-1", ShopSku: "SHOP-1", Name: "منتج", Price: "99.5", Available: "12" };
    expect(productToProduct(p)).toEqual({ code: "SKU-1", altCode: "SHOP-1", name: "منتج", sellPrice: 99.5 });
    expect(productToInventory(p)).toEqual({ code: "SKU-1", title: "منتج", onHand: 12 });
    expect(productToInventory({ Name: "no sku" })).toBeNull();
  });

  it("orderToDto: shipped status → Shipped; sums item prices + shipping", () => {
    const o = orderToDto(
      { OrderId: 555, CreatedAt: "2026-08-01T09:00:00+0000", Status: "shipped", Price: "210" },
      [
        { Sku: "SKU-1", Name: "منتج", PaidPrice: "100", ShippingAmount: "5" },
        { Sku: "SKU-2", Name: "منتج2", PaidPrice: "100", ShippingAmount: "5" },
      ],
    );
    expect(o.status).toBe("Shipped");
    expect(o.externalId).toBe("555");
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ code: "SKU-1", qty: 1, unitPrice: 100, shipping: 5 });
    expect(o.shippingTotal).toBe(10);
    expect(o.total).toBe(210);
  });

  it("orderToDto: non-shipped status stays DRAFT-ish (passed through lowercased)", () => {
    const o = orderToDto({ OrderId: 1, Status: "pending" }, []);
    expect(o.status).toBe("pending");
  });
});
