import { describe, it, expect } from "vitest";
import {
  normalizeSerial, parseSerials, validateSerials, serialRows,
  checkAvailableToShip, isSerialTracked,
} from "@/lib/erp/serials";

describe("normalization", () => {
  it("makes a scanned serial match a typed one", () => {
    expect(normalizeSerial("sn-1234 5678")).toBe("SN12345678");
    expect(normalizeSerial("SN12345678")).toBe("SN12345678");
  });

  it("reduces punctuation-only input to nothing", () => {
    expect(normalizeSerial("---")).toBe("");
    expect(normalizeSerial("")).toBe("");
  });
});

describe("parsing what was pasted", () => {
  it("splits on newlines, commas, semicolons and tabs", () => {
    expect(parseSerials("A1\nB2, C3;D4\tE5")).toEqual(["A1", "B2", "C3", "D4", "E5"]);
  });

  it("drops blank lines rather than making empty rows", () => {
    expect(parseSerials("A1\n\n\nB2\n")).toEqual(["A1", "B2"]);
    expect(parseSerials("")).toEqual([]);
  });
});

describe("validation", () => {
  it("accepts a matching set", () => {
    expect(validateSerials(["A1", "B2", "C3"], 3)).toBeNull();
  });

  it("refuses a count that does not equal the quantity — the whole invariant", () => {
    expect(validateSerials(["A1", "B2"], 3)).toMatch(/يساوي الكمية/);
    expect(validateSerials(["A1", "B2", "C3", "D4"], 3)).toMatch(/يساوي الكمية/);
    expect(validateSerials([], 1)).toMatch(/يساوي الكمية/);
  });

  it("refuses a duplicate inside the same line", () => {
    expect(validateSerials(["A1", "a-1"], 2)).toMatch(/مكرّر/);
  });

  it("refuses a serial that carries no characters at all", () => {
    expect(validateSerials(["A1", "--"], 2)).toMatch(/بدون أي حرف/);
  });

  it("refuses a serial already in stock for the same item", () => {
    expect(validateSerials(["A1"], 1, { alreadyInStock: ["a 1"] })).toMatch(/موجود بالفعل/);
    expect(validateSerials(["A1"], 1, { alreadyInStock: ["B2"] })).toBeNull();
  });

  it("refuses an absurdly long serial", () => {
    expect(validateSerials(["X".repeat(65)], 1)).toMatch(/٦٤/);
  });
});

describe("rows to insert", () => {
  it("keeps what was typed and stores the normalized form beside it", () => {
    expect(serialRows([" sn-1 ", "SN2"])).toEqual([
      { serial: "sn-1", normalizedSerial: "SN1" },
      { serial: "SN2", normalizedSerial: "SN2" },
    ]);
  });
});

describe("shipping check", () => {
  const known = [
    { normalizedSerial: "A1", status: "IN_STOCK" as const },
    { normalizedSerial: "B2", status: "SOLD" as const },
    { normalizedSerial: "C3", status: "SCRAPPED" as const },
    { normalizedSerial: "D4", status: "RETURNED" as const },
  ];

  it("passes serials that are in stock", () => {
    expect(checkAvailableToShip(["a-1"], known)).toBeNull();
  });

  it("lets a returned unit ship again", () => {
    expect(checkAvailableToShip(["D4"], known)).toBeNull();
  });

  it("names the offending serial and the reason", () => {
    expect(checkAvailableToShip(["B2"], known)).toMatch(/مُباع/);
    expect(checkAvailableToShip(["C3"], known)).toMatch(/مُعدَم/);
    expect(checkAvailableToShip(["ZZ"], known)).toMatch(/مش موجود/);
    expect(checkAvailableToShip(["ZZ"], known)).toContain("ZZ");
  });
});

describe("tracking mode", () => {
  it("only SERIAL demands serials", () => {
    expect(isSerialTracked("SERIAL")).toBe(true);
    expect(isSerialTracked("BATCH")).toBe(false);
    expect(isSerialTracked("NONE")).toBe(false);
    expect(isSerialTracked(null)).toBe(false);
  });
});
