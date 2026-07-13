import { describe, it, expect } from "vitest";
import { parseOrdersReport, parseInventoryReport, parseListingsReport } from "../mappers";

// Synthetic SP-API flat-file reports (tab-separated) to pin the column mapping
// the connector relies on. If Amazon's real report columns differ, these fail
// here rather than silently in production.

const ordersTsv = [
  "amazon-order-id\tpurchase-date\torder-status\tsku\tasin\tproduct-name\tquantity\titem-price\tshipping-price",
  "111-2222333-4444555\t2026-07-01\tShipped\tSKU1\tASIN1\tWidget\t2\t100\t5",
  "111-2222333-4444556\t2026-07-02\tCancelled\tSKU2\tASIN2\tGadget\t1\t50\t0",
].join("\n");

const ledgerTsv = [
  "Date\tFNSKU\tASIN\tMSKU\tTitle\tEvent Type\tReference ID\tQuantity",
  "2026-07-01\tX0001\tASIN1\tSKU1\tWidget\tReceipts\tR1\t10",
  "2026-07-02\tX0001\tASIN1\tSKU1\tWidget\tShipments\tS1\t-3",
].join("\n");

describe("Amazon report → DTO mappers", () => {
  it("parses the orders report, drops Cancelled, computes unit price + totals", () => {
    const orders = parseOrdersReport(Buffer.from(ordersTsv, "utf8"));
    expect(orders).toHaveLength(1);
    const o = orders[0];
    expect(o.externalId).toBe("111-2222333-4444555");
    expect(o.status).toBe("Shipped");
    expect(o.lines[0]).toMatchObject({ code: "SKU1", altCode: "ASIN1", qty: 2, unitPrice: 50, lineTotal: 100, shipping: 5 });
    expect(o.total).toBe(105);
  });

  it("parses the FBA ledger report, netting quantity per MSKU", () => {
    const inv = parseInventoryReport(Buffer.from(ledgerTsv, "utf8"));
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ code: "SKU1", title: "Widget", onHand: 7 });
  });

  it("parses the merchant listings report → products (sku, asin, name, price)", () => {
    const listingsTsv = [
      "item-name\tseller-sku\tprice\tquantity\tasin1",
      "Widget Red\tSKU1\t120.50\t5\tASIN1",
      "Widget Blue\tSKU2\t99\t0\tASIN2",
    ].join("\n");
    const products = parseListingsReport(Buffer.from(listingsTsv, "utf8"));
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ code: "SKU1", altCode: "ASIN1", name: "Widget Red", sellPrice: 120.5 });
  });
});
