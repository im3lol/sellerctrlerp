import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validateStoreUrl, verifyWooWebhook } from "../constants";
import { productToProduct } from "../products";
import { orderToDto } from "../orders";
import { productToInventory } from "../inventory";

describe("woo constants", () => {
  it("validateStoreUrl: requires https, returns the clean origin, drops path/query", () => {
    expect(validateStoreUrl("mystore.com")).toBe("https://mystore.com");
    expect(validateStoreUrl("https://shop.example.com/wp-json/x?y=1")).toBe("https://shop.example.com");
    expect(validateStoreUrl("http://insecure.com")).toBeNull(); // TLS required for Basic auth
    expect(validateStoreUrl("")).toBeNull();
  });

  it("verifyWooWebhook: base64 HMAC-SHA256 of the raw body, timing-safe", () => {
    const body = JSON.stringify({ id: 42, status: "completed" });
    const secret = "whsec_123";
    const good = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyWooWebhook(body, good, secret)).toBe(true);
    expect(verifyWooWebhook(body, good, "wrong")).toBe(false);
    expect(verifyWooWebhook(body, "tampered", secret)).toBe(false);
    expect(verifyWooWebhook(body, null, secret)).toBe(false);
  });
});

describe("woo mappers", () => {
  it("productToProduct: SKU is code, WC id is altCode; blank SKU falls back to WC-id", () => {
    expect(productToProduct({ id: 7, name: "قميص", sku: "SHIRT-1", price: "120.00" }))
      .toEqual({ code: "SHIRT-1", altCode: "7", name: "قميص", sellPrice: 120 });
    expect(productToProduct({ id: 9, name: "بلا كود", sku: "", price: "0" }).code).toBe("WC-9");
  });

  it("orderToDto: completed → Shipped; other status stays; money from strings", () => {
    const o = orderToDto({
      id: 100, number: "100", status: "completed", date_created_gmt: "2026-08-01T10:00:00",
      total: "260.00", shipping_total: "10.00", discount_total: "0",
      line_items: [{ name: "قميص", quantity: 2, sku: "SHIRT-1", product_id: 7, price: "120", total: "240" }],
    });
    expect(o.status).toBe("Shipped");
    expect(o.externalId).toBe("100");
    expect(o.date).toBe("2026-08-01T10:00:00Z");
    expect(o.lines[0]).toMatchObject({ code: "SHIRT-1", qty: 2, unitPrice: 120, lineTotal: 240 });
    expect(o.total).toBe(260);
    expect(orderToDto({ id: 2, status: "processing" }).status).toBe("processing");
  });

  it("productToInventory: drops SKU-less + unmanaged stock", () => {
    expect(productToInventory({ id: 1, name: "A", sku: "A1", manage_stock: true, stock_quantity: 5 }))
      .toEqual({ code: "A1", title: "A", onHand: 5 });
    expect(productToInventory({ id: 2, name: "B", sku: "", stock_quantity: 5 })).toBeNull();
    expect(productToInventory({ id: 3, name: "C", sku: "C1", manage_stock: false })).toBeNull();
  });
});
