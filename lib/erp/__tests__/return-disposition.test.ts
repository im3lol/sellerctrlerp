import { describe, it, expect } from "vitest";
import { planReturnStock, isUnsellable } from "../return-disposition";

describe("planReturnStock — disposition drives the stock side", () => {
  it("null/SELLABLE restocks the sellable warehouse (unchanged legacy behavior)", () => {
    expect(planReturnStock(null, "WH1", null)).toEqual({ kind: "RESTOCK", warehouseId: "WH1" });
    expect(planReturnStock("SELLABLE", "WH1", null)).toEqual({ kind: "RESTOCK", warehouseId: "WH1" });
    expect(planReturnStock(undefined, "WH1", "DMG")).toEqual({ kind: "RESTOCK", warehouseId: "WH1" });
  });
  it("unsellable + a chosen damaged warehouse → restock THERE (segregated, not sellable)", () => {
    expect(planReturnStock("DAMAGED", "WH1", "DMG")).toEqual({ kind: "RESTOCK", warehouseId: "DMG" });
    expect(planReturnStock("DEFECTIVE", "WH1", "DMG")).toEqual({ kind: "RESTOCK", warehouseId: "DMG" });
    expect(planReturnStock("UNSELLABLE", "WH1", "DMG")).toEqual({ kind: "RESTOCK", warehouseId: "DMG" });
  });
  it("unsellable + no damaged warehouse → WRITE_OFF (the bug fix: never restocks as sellable)", () => {
    expect(planReturnStock("DAMAGED", "WH1", null)).toEqual({ kind: "WRITE_OFF" });
    expect(planReturnStock("CUSTOMER_DAMAGED", "WH1", null)).toEqual({ kind: "WRITE_OFF" });
  });
  it("isUnsellable treats anything not SELLABLE (and non-empty) as unsellable", () => {
    expect(isUnsellable(null)).toBe(false);
    expect(isUnsellable("SELLABLE")).toBe(false);
    expect(isUnsellable("DAMAGED")).toBe(true);
  });
});
