import { describe, it, expect } from "vitest";
import { toTxnRow, type ApiTransaction } from "../amazon/transactions";

const egp = (n: number) => ({ currencyAmount: n, currencyCode: "EGP" });

/**
 * The payload Amazon actually returned for order 408-1397493-3820363 — the one on the
 * Seller Central Transaction details page: product charges 1,300.00, FBA pick & pack
 * 35.50 + 4.97 tax, referral 156.00 + 21.84 tax, balance change 1,081.69.
 */
const screenshotTxn: ApiTransaction = {
  transactionId: "yUWKk1oElzzRWuhdByEYpx31vLsROZNVKf7iw0TRmJI",
  transactionType: "Shipment",
  transactionStatus: "DEFERRED",
  postedDate: "2026-09-09T12:05:57Z",
  description: "Order Payment",
  totalAmount: egp(1081.69),
  relatedIdentifiers: [
    { relatedIdentifierName: "SHIPMENT_ID", relatedIdentifierValue: "123525586042202" },
    { relatedIdentifierName: "SETTLEMENT_ID", relatedIdentifierValue: "27791108222" },
    { relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "408-1397493-3820363" },
  ],
  items: [{
    description: "BIODANCE Refreshing Sea kelp Real Deep Mask",
    totalAmount: egp(1081.69),
    contexts: [{ contextType: "ProductContext", asin: "B0DR7P1TKL", sku: "R0-3MLK-TSHF", quantityShipped: 1 }],
    breakdowns: [
      { breakdownType: "ProductCharges", breakdownAmount: egp(1300), breakdowns: [
        { breakdownType: "OurPricePrincipal", breakdownAmount: egp(1300), breakdowns: [] },
      ] },
      { breakdownType: "AmazonFees", breakdownAmount: egp(-218.31), breakdowns: [
        { breakdownType: "FBAPerUnitFulfillmentFee", breakdownAmount: egp(-40.47), breakdowns: [
          { breakdownType: "Base", breakdownAmount: egp(-35.5), breakdowns: [] },
          { breakdownType: "Tax", breakdownAmount: egp(-4.97), breakdowns: [] },
        ] },
        { breakdownType: "Commission", breakdownAmount: egp(-177.84), breakdowns: [
          { breakdownType: "Base", breakdownAmount: egp(-156), breakdowns: [] },
          { breakdownType: "Tax", breakdownAmount: egp(-21.84), breakdowns: [] },
        ] },
      ] },
    ],
  }],
};

describe("Amazon transaction mapping", () => {
  it("reads the Seller Central figures line for line", () => {
    const r = toTxnRow(screenshotTxn);
    expect(r.productSales).toBe(1300);
    expect(r.fbaFees).toBe(-40.47);
    expect(r.items[0].fbaFeeTax).toBe(-4.97);
    expect(r.sellingFees).toBe(-177.84);
    expect(r.items[0].commissionTax).toBe(-21.84);
    expect(r.total).toBe(1081.69);
    // The identity the whole page rests on.
    expect(r.productSales + r.fbaFees + r.sellingFees).toBeCloseTo(r.total, 2);
  });

  it("keeps the deferred status and the per-product context", () => {
    const r = toTxnRow(screenshotTxn);
    expect(r.status).toBe("Deferred");
    expect(r.orderId).toBe("408-1397493-3820363");
    expect(r.items[0]).toMatchObject({ sku: "R0-3MLK-TSHF", asin: "B0DR7P1TKL", quantity: 1 });
  });

  it("calls a Shipment an Order, the way everything reading the table already does", () => {
    expect(toTxnRow(screenshotTxn).type).toBe("Order");
  });

  // The trap: Amazon reports one economic event up to three times with a different
  // transactionId, settlement id and event group each time. Keyed on any of those, an
  // order's fees would be counted two or three times.
  it("gives one order the same key through its whole lifecycle", () => {
    const deferred = toTxnRow(screenshotTxn);
    const releasing = toTxnRow({ ...screenshotTxn, transactionId: "different-1", transactionStatus: "DEFERRED_RELEASED",
      relatedIdentifiers: [
        { relatedIdentifierName: "SHIPMENT_ID", relatedIdentifierValue: "123525586042202" },
        { relatedIdentifierName: "SETTLEMENT_ID", relatedIdentifierValue: "99999999" },
        { relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "408-1397493-3820363" },
      ] });
    const released = toTxnRow({ ...screenshotTxn, transactionId: "different-2", transactionStatus: "RELEASED" });

    expect(releasing.dedupKey).toBe(deferred.dedupKey);
    expect(released.dedupKey).toBe(deferred.dedupKey);
    // DEFERRED_RELEASED means the hold has lifted — it is not still pending.
    expect(releasing.status).toBe("Released");
    expect(released.status).toBe("Released");
  });

  it("separates two refunds on the same order", () => {
    const base: ApiTransaction = {
      transactionType: "Refund", transactionStatus: "RELEASED", totalAmount: egp(-100),
      relatedIdentifiers: [{ relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "111-2-3" }],
    };
    // No shipment id on a refund, so the amount has to do the distinguishing.
    expect(toTxnRow(base).dedupKey).not.toBe(toTxnRow({ ...base, totalAmount: egp(-250) }).dedupKey);
  });

  it("keeps a transaction that belongs to no order", () => {
    // Ads and adjustments have no order and no items; the whole value is `other` so the
    // row still balances.
    const ads = toTxnRow({
      transactionId: "ads-1", transactionType: "ProductAdsPayment", transactionStatus: "RELEASED",
      totalAmount: egp(-816.66), postedDate: "2026-09-02T00:00:00Z",
    });
    expect(ads.total).toBe(-816.66);
    expect(ads.other).toBe(-816.66);
    expect(ads.orderId).toBeNull();
    expect(ads.dedupKey).toBe("txn|ads-1");
  });

  it("captures a fee type it has never seen rather than dropping it", () => {
    const withNewFee = toTxnRow({
      ...screenshotTxn,
      items: [{
        totalAmount: egp(1250),
        contexts: [{ contextType: "ProductContext", sku: "X", quantityShipped: 1 }],
        breakdowns: [
          { breakdownType: "ProductCharges", breakdownAmount: egp(1300), breakdowns: [] },
          { breakdownType: "AmazonFees", breakdownAmount: egp(-50), breakdowns: [
            { breakdownType: "SomeBrandNewFee", breakdownAmount: egp(-50), breakdowns: [] },
          ] },
        ],
      }],
    });
    expect(withNewFee.otherTransactionFees).toBe(-50);
  });
});
