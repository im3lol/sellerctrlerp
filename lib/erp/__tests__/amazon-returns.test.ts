import { describe, it, expect } from "vitest";
import { parseReturnsReport, returnDedupKey } from "../amazon-returns";

const HEADER = "return-date\torder-id\tsku\tasin\tfnsku\tproduct-name\tquantity\tfulfillment-center-id\tdetailed-disposition\treason\tstatus\tlicense-plate-number\tcustomer-comments";

const row = (over: Partial<Record<string, string>> = {}) => {
  const d: Record<string, string> = {
    "return-date": "2026-07-01T10:00:00+00:00", "order-id": "402-1234567-1234567", sku: "SKU-1",
    asin: "B000000001", fnsku: "X0000001", "product-name": "منتج", quantity: "1",
    "fulfillment-center-id": "CAI1", "detailed-disposition": "SELLABLE", reason: "NO_REASON_GIVEN",
    status: "Unit returned to inventory", "license-plate-number": "LPN0001", "customer-comments": "",
    ...over,
  };
  return HEADER.split("\t").map((h) => d[h] ?? "").join("\t");
};

describe("parseReturnsReport", () => {
  it("parses rows keyed by header (order-independent)", () => {
    const tsv = [HEADER, row(), row({ sku: "SKU-2", "detailed-disposition": "CUSTOMER_DAMAGED", quantity: "2" })].join("\n");
    const rows = parseReturnsReport(tsv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ orderId: "402-1234567-1234567", sku: "SKU-1", disposition: "SELLABLE", quantity: 1, licensePlateNumber: "LPN0001" });
    expect(rows[1]).toMatchObject({ sku: "SKU-2", disposition: "CUSTOMER_DAMAGED", quantity: 2 });
    expect(rows[0].returnDate?.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("skips rows without order-id or sku and handles empty input", () => {
    expect(parseReturnsReport("")).toEqual([]);
    const tsv = [HEADER, row({ "order-id": "" }), row({ sku: "" }), row()].join("\n");
    expect(parseReturnsReport(tsv)).toHaveLength(1);
  });

  it("defaults quantity to 1 and tolerates a bad date", () => {
    const [r] = parseReturnsReport([HEADER, row({ quantity: "", "return-date": "غير صالح" })].join("\n"));
    expect(r.quantity).toBe(1);
    expect(r.returnDate).toBeNull();
  });
});

describe("returnDedupKey", () => {
  it("is stable for the same unit and distinguishes units by LPN", () => {
    const [a] = parseReturnsReport([HEADER, row()].join("\n"));
    const [b] = parseReturnsReport([HEADER, row()].join("\n"));
    const [c] = parseReturnsReport([HEADER, row({ "license-plate-number": "LPN0002" })].join("\n"));
    expect(returnDedupKey(a)).toBe(returnDedupKey(b));
    expect(returnDedupKey(a)).not.toBe(returnDedupKey(c));
  });
});
