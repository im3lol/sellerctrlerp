import { describe, it, expect } from "vitest";
import {
  isValidFactor, toBaseQuantity, toBasePrice, fromBaseQuantity, storeLine,
  displayQuantity, unitOptions, unitForBarcode, validateUnitSet, type ItemUnit,
} from "@/lib/erp/item-units";

const carton = (over: Partial<ItemUnit> = {}): ItemUnit =>
  ({ id: "u2", uomId: "uom-carton", label: "كرتونة", factor: 12, isBase: false, ...over });
const piece = (over: Partial<ItemUnit> = {}): ItemUnit =>
  ({ id: "u1", uomId: "uom-piece", label: "قطعة", factor: 1, isBase: true, ...over });

describe("factor validation", () => {
  it("refuses anything that would corrupt derived quantities", () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined, "abc"]) {
      expect(isValidFactor(bad), String(bad)).toBe(false);
    }
    expect(isValidFactor(12)).toBe(true);
    expect(isValidFactor(0.5)).toBe(true); // half-unit is legitimate (a 500g bag of a kg base)
  });

  it("throws rather than silently writing a wrong quantity", () => {
    expect(() => toBaseQuantity(5, 0)).toThrow();
    expect(() => toBasePrice(120, -3)).toThrow();
  });
});

describe("conversion", () => {
  it("multiplies quantity and divides price by the same factor", () => {
    expect(toBaseQuantity(5, 12)).toBe(60);
    expect(toBasePrice(120, 12)).toBe(10);
  });

  it("round-trips a quantity back to what was typed", () => {
    for (const [qty, f] of [[5, 12], [1, 1], [2.5, 6], [7, 0.5]] as const) {
      expect(fromBaseQuantity(toBaseQuantity(qty, f), f)).toBe(qty);
    }
  });

  it("keeps line value identical whichever unit it was entered in", () => {
    const perCarton = storeLine({ quantity: 5, unitPrice: 120, factor: 12 });
    const perPiece = storeLine({ quantity: 60, unitPrice: 10, factor: 1 });
    expect(perCarton.quantity).toBe(perPiece.quantity);
    expect(perCarton.quantity * perCarton.unitPrice).toBeCloseTo(perPiece.quantity * perPiece.unitPrice, 6);
  });

  it("stores the factor it used, so a later edit to the unit can't rewrite history", () => {
    expect(storeLine({ quantity: 3, unitPrice: 60, factor: 12 }).uomFactor).toBe(12);
  });
});

describe("display", () => {
  it("shows both units when the line was entered in a non-base unit", () => {
    const d = displayQuantity(60, 12, "كرتونة", "قطعة");
    expect(d.primary).toBe(5);
    expect(d.primaryLabel).toBe("كرتونة");
    // ar-EG-u-nu-latn: Arabic locale, Latin numerals — the convention across this app.
    expect(d.secondary).toBe("60 قطعة");
  });

  it("says nothing extra for a base-unit line", () => {
    expect(displayQuantity(60, 1, "قطعة", "قطعة").secondary).toBeNull();
    expect(displayQuantity(60, null, null, "قطعة").secondary).toBeNull();
  });
});

describe("unit list", () => {
  it("keeps a single base first", () => {
    const opts = unitOptions([carton(), piece()], "قطعة");
    expect(opts[0].isBase).toBe(true);
    expect(opts).toHaveLength(2);
  });

  it("never leaves the picker without a base option", () => {
    const opts = unitOptions([carton()], "قطعة");
    expect(opts[0].isBase).toBe(true);
    expect(opts[0].factor).toBe(1);
    expect(opts[0].label).toBe("قطعة");
  });

  it("drops units with an unusable factor", () => {
    expect(unitOptions([piece(), carton({ factor: 0 })], "قطعة")).toHaveLength(1);
  });
});

describe("barcode → unit", () => {
  it("picks the carton when the carton barcode is scanned", () => {
    const units = [piece({ barcode: "1111" }), carton({ barcode: "622-9999" })];
    expect(unitForBarcode(units, "6229999")?.label).toBe("كرتونة");
    expect(unitForBarcode(units, "1111")?.label).toBe("قطعة");
    expect(unitForBarcode(units, "7777")).toBeNull();
    expect(unitForBarcode(units, "")).toBeNull();
  });
});

describe("unit set validation", () => {
  const ok = [{ uomId: "p", factor: 1, isBase: true }, { uomId: "c", factor: 12, isBase: false }];

  it("accepts a correct set", () => {
    expect(validateUnitSet(ok)).toBeNull();
    expect(validateUnitSet([])).toBeNull();
  });

  it("requires exactly one base at factor 1", () => {
    expect(validateUnitSet([{ uomId: "c", factor: 12, isBase: false }])).toMatch(/أساسية/);
    expect(validateUnitSet([...ok, { uomId: "b", factor: 6, isBase: true }])).toMatch(/أساسية/);
    expect(validateUnitSet([{ uomId: "p", factor: 5, isBase: true }])).toMatch(/١/);
  });

  it("rejects duplicates and shared barcodes", () => {
    expect(validateUnitSet([...ok, { uomId: "c", factor: 24, isBase: false }])).toMatch(/مكرّرة/);
    expect(validateUnitSet([
      { uomId: "p", factor: 1, isBase: true, barcode: "55" },
      { uomId: "c", factor: 12, isBase: false, barcode: "55" },
    ])).toMatch(/الباركود/);
  });

  it("rejects a non-positive factor anywhere in the set", () => {
    expect(validateUnitSet([...ok, { uomId: "x", factor: 0, isBase: false }])).toMatch(/أكبر من صفر/);
  });
});
