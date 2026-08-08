import { describe, it, expect } from "vitest";
import { parseRemovalsReport, removalDedupKey } from "../amazon-removals";

const TSV = [
  "request-date\torder-id\torder-type\torder-status\tsku\tfnsku\tdisposition\trequested-quantity\tcancelled-quantity\tdisposed-quantity\tshipped-quantity",
  "2026-08-01\tRO-1\tReturn\tCompleted\tSKU-A\tX00A\tSellable\t5\t0\t0\t5",
  "2026-08-02\tRO-2\tDisposal\tCompleted\tSKU-B\tX00B\tDefective\t3\t0\t3\t0",
  "\t\t\t\t\t\t\t\t\t\t",  // junk row (no order/sku) → skipped
].join("\n");

describe("parseRemovalsReport", () => {
  const rows = parseRemovalsReport(TSV);
  it("parses a row per removal line, skipping junk", () => {
    expect(rows).toHaveLength(2);
  });
  it("splits shipped (return) vs disposed quantities", () => {
    const ret = rows.find((r) => r.removalOrderId === "RO-1")!;
    expect(ret).toMatchObject({ orderType: "Return", sku: "SKU-A", shippedQty: 5, disposedQty: 0 });
    const disp = rows.find((r) => r.removalOrderId === "RO-2")!;
    expect(disp).toMatchObject({ orderType: "Disposal", sku: "SKU-B", disposedQty: 3, shippedQty: 0 });
  });
  it("dedupKey is stable + distinct per (order, sku, disposition)", () => {
    expect(removalDedupKey(rows[0])).toBe(removalDedupKey(rows[0]));
    expect(removalDedupKey(rows[0])).not.toBe(removalDedupKey(rows[1]));
  });
  it("returns [] for an empty/headerless file", () => {
    expect(parseRemovalsReport("")).toEqual([]);
    expect(parseRemovalsReport("just one line")).toEqual([]);
  });
});
