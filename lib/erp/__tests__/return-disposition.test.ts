import { describe, it, expect } from "vitest";
import { planReturnStock, isUnsellable, planReceipt, planCondition, RETURN_CONDITIONS } from "../return-disposition";

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

describe("planReceipt — the trader's receipt gate on a platform return", () => {
  it("received-sellable → reverse invoice + restock as sellable", () => {
    expect(planReceipt("RECEIVED_SELLABLE")).toEqual({ restock: true, disposition: "SELLABLE", status: "RECEIVED" });
  });
  it("received-damaged → reverse invoice + restock unsellable (write-off / damaged wh)", () => {
    expect(planReceipt("RECEIVED_DAMAGED")).toEqual({ restock: true, disposition: "UNSELLABLE", status: "RECEIVED" });
  });
  it("NOT received → reverse invoice only, NO restock (awaiting reimbursement)", () => {
    const p = planReceipt("NOT_RECEIVED");
    expect(p.restock).toBe(false);
    expect(p.status).toBe("NOT_RECEIVED");
  });
});

describe("planCondition — what actually came back", () => {
  it("puts a dented BOX back on sale, because the product is fine", () => {
    // The whole reason this exists: one "damaged" button either restocked goods that
    // cannot be sold, or wrote off goods that could have been.
    expect(planCondition("PACKAGING_DAMAGED")).toEqual({ restock: true, disposition: "SELLABLE", writeOff: false });
    expect(planCondition("SELLABLE")).toEqual({ restock: true, disposition: "SELLABLE", writeOff: false });
  });

  it("keeps opened, scratched and used units in stock but off sale", () => {
    // Real inventory worth real money — just not sellable as new.
    for (const c of ["OPENED", "SCRATCHED", "USED"] as const) {
      expect(planCondition(c)).toEqual({ restock: true, disposition: "UNSELLABLE", writeOff: false });
    }
  });

  it("lets a destroyed unit into no warehouse at all", () => {
    // Putting a worthless unit on a shelf inflates stock value with something that will
    // never sell, so this is the one condition that writes off.
    expect(planCondition("DESTROYED")).toMatchObject({ writeOff: true, disposition: "UNSELLABLE" });
  });

  it("never marks anything but genuinely sellable stock as sellable", () => {
    const sellable = RETURN_CONDITIONS.filter((c) => planCondition(c).disposition === "SELLABLE");
    expect(sellable).toEqual(["SELLABLE", "PACKAGING_DAMAGED"]);
  });
});
