import { describe, it, expect } from "vitest";
import { parseNoonCreds } from "../constants";
import { rowsToInventory } from "../inventory";
import { offerToProduct } from "../products";
import { mapNoonOrder } from "../orders";

describe("parseNoonCreds — credential validation", () => {
  const good = JSON.stringify({ key_id: "k", private_key: "-----BEGIN", channel_identifier: "s@p1.idp.noon.partners", project_code: "PRJ1" });
  it("parses a complete credential file", () => {
    expect(parseNoonCreds(good).project_code).toBe("PRJ1");
  });
  it("rejects invalid JSON", () => expect(() => parseNoonCreds("not json")).toThrow());
  it("rejects a file missing a required key", () =>
    expect(() => parseNoonCreds(JSON.stringify({ key_id: "k", private_key: "x" }))).toThrow());
});

describe("rowsToInventory — stock-list → on-hand per SKU", () => {
  it("sums quantity across warehouses for the same SKU", () => {
    const inv = rowsToInventory([
      { partner_sku: "A", warehouse_code: "W1", qty: 3 },
      { partner_sku: "A", warehouse_code: "W2", qty: 2 },
      { partner_sku: "B", quantity: 5, title: "Item B" },
    ]);
    expect(inv.find((r) => r.code === "A")?.onHand).toBe(5);
    expect(inv.find((r) => r.code === "B")).toMatchObject({ code: "B", title: "Item B", onHand: 5 });
  });
  it("falls back across qty field names and drops rows with no SKU", () => {
    const inv = rowsToInventory([{ net_stock: 7, sku: "C" }, { qty: 1 }]);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ code: "C", onHand: 7 });
  });
});

describe("offerToProduct — offer → catalog row", () => {
  it("takes the first non-null offer price and carries the noon sku as altCode", () => {
    const p = offerToProduct("MY-SKU", {
      partner_sku: "MY-SKU", sku: "N123", title: "Widget",
      offers: [{ price: { amount: null } }, { price: { amount: 149.99, currency: "EGP" } }],
    });
    expect(p).toMatchObject({ code: "MY-SKU", altCode: "N123", name: "Widget", sellPrice: 149.99 });
  });
  it("defaults price to 0 and name to the code when absent", () => {
    expect(offerToProduct("X", {})).toMatchObject({ code: "X", name: "X", sellPrice: 0 });
  });
});

describe("mapNoonOrder — FBPI order → MarketplaceOrder", () => {
  it("maps lines, defaults qty to 1, and totals the subtotal", () => {
    const o = mapNoonOrder({
      fbpi_order_nr: "NFBO1", currency_code: "EGP",
      items: [
        { partner_sku: "A", sku: "N-A", delivered_invoice_price: 100 },
        { partner_sku: "B", qty: 2, delivered_invoice_price: 50, mp_status: "MP_ITEM_STATUS_SHIPPED" },
      ],
    });
    expect(o.externalId).toBe("NFBO1");
    expect(o.lines[0]).toMatchObject({ code: "A", altCode: "N-A", qty: 1, unitPrice: 100, lineTotal: 100 });
    expect(o.lines[1]).toMatchObject({ code: "B", qty: 2, lineTotal: 100 });
    expect(o.subtotal).toBe(200);
    expect(o.total).toBe(200);
  });
  it("flags a fully-shipped order as Shipped and a cancelled one as Canceled", () => {
    expect(mapNoonOrder({ fbpi_order_nr: "S", items: [{ partner_sku: "A", mp_status: "MP_ITEM_STATUS_SHIPPED" }] }).status).toBe("Shipped");
    expect(mapNoonOrder({ fbpi_order_nr: "C", items: [{ partner_sku: "A", mp_status: "MP_ITEM_STATUS_CANCELLED" }] }).status).toBe("Canceled");
    expect(mapNoonOrder({ fbpi_order_nr: "P", items: [{ partner_sku: "A", mp_status: "MP_ITEM_STATUS_CONFIRMED" }] }).status).toBe("Pending");
  });
});
