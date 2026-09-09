import { describe, it, expect } from "vitest";
import { toMarketplaceOrder } from "../amazon/orders";

const money = (n: number) => ({ CurrencyCode: "EGP", Amount: n.toFixed(2) });
const order = (total?: number) => ({
  AmazonOrderId: "404-8234280-6421164",
  PurchaseDate: "2026-09-06T01:28:00Z",
  OrderStatus: "Shipped",
  FulfillmentChannel: "AFN",
  ...(total != null ? { OrderTotal: money(total) } : {}),
});

describe("Amazon order totals", () => {
  // The payload Amazon actually returned for this order, verbatim. The waiver came back
  // in ShippingDiscount; PromotionDiscount was 0.00 and ShipPromotionDiscount — the field
  // the mapper used to rely on — was not in the response at all.
  const realItem = {
    ASIN: "B0G6ZB5DZX", SellerSKU: "1CPO-NJOL-XTXJ", QuantityOrdered: 1,
    ItemPrice: money(3320), ShippingPrice: money(20),
    PromotionDiscount: money(0), ShippingDiscount: money(20),
  };

  it("matches what Amazon charged the buyer", () => {
    const o = toMarketplaceOrder(order(3320), [realItem]);
    expect(o.total).toBe(3320);      // was 3340 — 20 EGP of revenue that never existed
    expect(o.discount).toBe(20);
    expect(o.subtotal).toBe(3320);
    expect(o.shippingTotal).toBe(20);
  });

  it("reads a shipping waiver even when OrderTotal is missing", () => {
    // Falls back to the itemised fields, which now include ShippingDiscount.
    const o = toMarketplaceOrder(order(), [realItem]);
    expect(o.discount).toBe(20);
    expect(o.total).toBe(3320);
  });

  it("leaves an order alone when the components already agree", () => {
    const o = toMarketplaceOrder(order(1000), [{
      SellerSKU: "X", QuantityOrdered: 2, ItemPrice: money(1000), ShippingPrice: money(0),
    }]);
    expect(o.discount).toBe(0);
    expect(o.total).toBe(1000);
    expect(o.lines[0].unitPrice).toBe(500);
  });

  it("absorbs a reduction Amazon does not itemise at all", () => {
    // The whole point of trusting OrderTotal: a field we have never heard of costs
    // nothing instead of quietly inflating revenue.
    const o = toMarketplaceOrder(order(900), [{
      SellerSKU: "X", QuantityOrdered: 1, ItemPrice: money(1000), ShippingPrice: money(0),
    }]);
    expect(o.discount).toBe(100);
    expect(o.total).toBe(900);
  });

  it("refuses to invent a negative discount", () => {
    // Amazon asking for MORE than the components means a charge we don't model. Booking
    // it as a negative discount would be a silent plug; keep the itemised figure so the
    // difference stays visible instead.
    const o = toMarketplaceOrder(order(1200), [{
      SellerSKU: "X", QuantityOrdered: 1, ItemPrice: money(1000), ShippingPrice: money(0),
      PromotionDiscount: money(0),
    }]);
    expect(o.discount).toBe(0);
    expect(o.total).toBe(1000);
  });
});
