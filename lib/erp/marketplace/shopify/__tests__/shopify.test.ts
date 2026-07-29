import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validateShop, shopifyHmacValid } from "../constants";
import { productToRows } from "../products";
import { orderToDto } from "../orders";
import { variantToInventory } from "../inventory";
import { balanceTxnToSettlement } from "../payouts";

describe("validateShop — trust-boundary guard", () => {
  it("accepts a bare myshopify domain", () => expect(validateShop("Acme-Store.myshopify.com")).toBe("acme-store.myshopify.com"));
  it("strips scheme + path", () => expect(validateShop("https://acme.myshopify.com/admin")).toBe("acme.myshopify.com"));
  it("rejects a foreign host", () => expect(validateShop("acme.evil.com")).toBeNull());
  it("rejects an injection attempt", () => expect(validateShop("acme.myshopify.com.evil.com")).toBeNull());
  it("rejects empty", () => expect(validateShop("")).toBeNull());
});

describe("shopifyHmacValid — callback signature (security)", () => {
  const secret = "shpss_test_secret";
  const sign = (entries: [string, string][]) => {
    const msg = entries.filter(([k]) => k !== "hmac").sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
    return createHmac("sha256", secret).update(msg).digest("hex");
  };
  it("accepts a correctly-signed query", () => {
    const base: [string, string][] = [["code", "abc"], ["shop", "acme.myshopify.com"], ["state", "xyz"], ["timestamp", "1700000000"]];
    const p = new URLSearchParams([...base, ["hmac", sign(base)]]);
    expect(shopifyHmacValid(p, secret)).toBe(true);
  });
  it("rejects a tampered param", () => {
    const base: [string, string][] = [["code", "abc"], ["shop", "acme.myshopify.com"]];
    const p = new URLSearchParams([...base, ["hmac", sign(base)]]);
    p.set("shop", "evil.myshopify.com"); // swapped after signing
    expect(shopifyHmacValid(p, secret)).toBe(false);
  });
  it("rejects the wrong secret", () => {
    const base: [string, string][] = [["code", "abc"], ["shop", "acme.myshopify.com"]];
    const p = new URLSearchParams([...base, ["hmac", sign(base)]]);
    expect(shopifyHmacValid(p, "shpss_other")).toBe(false);
  });
  it("rejects a missing hmac", () => expect(shopifyHmacValid(new URLSearchParams("code=abc"), secret)).toBe(false));
});

describe("mappers → neutral DTOs", () => {
  it("productToRows: one row per variant, SKU as code + GID as altCode", () => {
    const rows = productToRows({ title: "قميص", variants: { nodes: [
      { id: "gid://shopify/ProductVariant/1", sku: "SH-RED", title: "أحمر", price: "199.50" },
      { id: "gid://shopify/ProductVariant/2", sku: "", title: "Default Title", price: "150" },
    ] } });
    expect(rows[0]).toEqual({ code: "SH-RED", altCode: "gid://shopify/ProductVariant/1", name: "قميص - أحمر", sellPrice: 199.5 });
    // blank SKU falls back to the GID (never a blank code) + no "Default Title" suffix
    expect(rows[1]).toEqual({ code: "gid://shopify/ProductVariant/2", altCode: "gid://shopify/ProductVariant/2", name: "قميص", sellPrice: 150 });
  });

  it("orderToDto: FULFILLED → Shipped, money extracted from shopMoney", () => {
    const dto = orderToDto({
      name: "#1001", createdAt: "2026-07-01T10:00:00Z", displayFulfillmentStatus: "FULFILLED",
      subtotalPriceSet: { shopMoney: { amount: "300" } },
      totalShippingPriceSet: { shopMoney: { amount: "30" } },
      totalPriceSet: { shopMoney: { amount: "330" } },
      lineItems: { nodes: [{ name: "قميص أحمر", quantity: 2, sku: "SH-RED", variant: { id: "gid://v/1" }, originalUnitPriceSet: { shopMoney: { amount: "150" } }, originalTotalSet: { shopMoney: { amount: "300" } } }] },
    });
    expect(dto.externalId).toBe("#1001");
    expect(dto.status).toBe("Shipped");
    expect(dto.total).toBe(330);
    expect(dto.lines[0]).toEqual({ code: "SH-RED", altCode: "gid://v/1", name: "قميص أحمر", qty: 2, unitPrice: 150, lineTotal: 300, shipping: 0 });
  });

  it("orderToDto: unfulfilled stays non-Shipped (→ DRAFT)", () => {
    const dto = orderToDto({
      name: "#1002", createdAt: "2026-07-02T10:00:00Z", displayFulfillmentStatus: "UNFULFILLED",
      subtotalPriceSet: null, totalShippingPriceSet: null, totalPriceSet: { shopMoney: { amount: "99" } },
      lineItems: { nodes: [] },
    });
    expect(dto.status).toBe("UNFULFILLED");
    expect(dto.subtotal).toBe(0);
  });

  it("variantToInventory: drops SKU-less variants", () => {
    expect(variantToInventory({ sku: "SH-RED", displayName: "قميص - أحمر", inventoryQuantity: 7 })).toEqual({ code: "SH-RED", title: "قميص - أحمر", onHand: 7 });
    expect(variantToInventory({ sku: null, displayName: "x", inventoryQuantity: 3 })).toBeNull();
  });
});

describe("balanceTxnToSettlement — Shopify payouts → SettlementTxn (money path)", () => {
  const txn = (o: Partial<{ id: string; type: string; date: string; amount: string; fee: string; net: string; order: string | null }>) => ({
    id: o.id ?? "gid://t/1", type: o.type ?? "charge", transactionDate: o.date ?? "2026-07-10T00:00:00Z",
    amount: { amount: o.amount ?? "100" }, fee: { amount: o.fee ?? "3" }, net: { amount: o.net ?? "97" },
    associatedOrder: o.order === undefined ? { name: "#1001" } : o.order === null ? null : { name: o.order },
  });

  it("charge → Order: gross to productSales, fee stored NEGATIVE, net as total, order matched", () => {
    const s = balanceTxnToSettlement(txn({ type: "charge", amount: "100", fee: "3", net: "97" }));
    expect(s.type).toBe("Order");
    expect(s.orderId).toBe("#1001");
    expect(s.productSales).toBe(100);
    expect(s.sellingFees).toBe(-3); // Amazon sign convention: fees negative
    expect(s.total).toBe(97);
    // GL invariant: Dr wallet(net) + Dr fee(fee) = Cr receivable(gross)
    expect(s.total + (-s.sellingFees)).toBe(s.productSales);
  });

  it("payout → Transfer: net (negative) flows to bank, no order", () => {
    const s = balanceTxnToSettlement(txn({ type: "payout", amount: "-500", fee: "0", net: "-500", order: null }));
    expect(s.type).toBe("Transfer");
    expect(s.orderId).toBe("");
    expect(s.total).toBe(-500);
    expect(s.productSales).toBe(0);
  });

  it("refund → Adjustment (NOT 'Refund'): aggregate wallet-vs-expense, skips qty-based return cycle", () => {
    const s = balanceTxnToSettlement(txn({ type: "refund", amount: "-50", fee: "0", net: "-50" }));
    expect(s.type).toBe("Adjustment");
    expect(s.type).not.toBe("Refund");
    expect(s.total).toBe(-50);
  });

  it("uses net = amount - fee when net is absent", () => {
    const raw = txn({ type: "charge", amount: "100", fee: "3" });
    // @ts-expect-error — simulate a payload without net
    raw.net = null;
    expect(balanceTxnToSettlement(raw).total).toBe(97);
  });
});
