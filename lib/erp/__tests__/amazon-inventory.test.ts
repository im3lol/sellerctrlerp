import { describe, it, expect } from "vitest";
import { parseInventoryLedger } from "@/lib/erp/amazon-inventory";

const SAMPLE = [
  `"Date","FNSKU","ASIN","MSKU","Title","Event Type","Reference ID","Quantity","Fulfillment Center","Disposition","Reason"`,
  `"07/08/2026","X1","B1","SKU-A","Item A","Receipts","","10","FFE8","SELLABLE",""`,
  `"07/08/2026","X1","B1","SKU-A","Item A","Shipments","","-3","FFE8","SELLABLE",""`,
  `"07/08/2026","X2","B2","SKU-B","Item B","Receipts","","5","FFE8","SELLABLE",""`,
  `"07/08/2026","X2","B2","SKU-B","Item B","VendorReturns","","-2","FFE8","SELLABLE",""`,
].join("\n");

describe("parseInventoryLedger", () => {
  it("computes net on-hand per MSKU across events", () => {
    const s = parseInventoryLedger(SAMPLE);
    expect(s.perSku.get("SKU-A")).toBe(7); // 10 - 3
    expect(s.perSku.get("SKU-B")).toBe(3); // 5 - 2
    expect(s.totalUnits).toBe(10);
    expect(s.perSku.size).toBe(2);
  });

  it("breaks down by event type", () => {
    const s = parseInventoryLedger(SAMPLE);
    expect(s.events["Receipts"]).toEqual({ n: 2, qty: 15 });
    expect(s.events["Shipments"]).toEqual({ n: 1, qty: -3 });
    expect(s.events["VendorReturns"]).toEqual({ n: 1, qty: -2 });
  });

  it("captures titles", () => {
    const s = parseInventoryLedger(SAMPLE);
    expect(s.titles.get("SKU-A")).toBe("Item A");
  });

  it("throws on a file missing MSKU/Quantity columns", () => {
    expect(() => parseInventoryLedger(`"a","b"\n"1","2"`)).toThrow();
  });
});
