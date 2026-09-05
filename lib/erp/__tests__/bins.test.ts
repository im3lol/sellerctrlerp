import { describe, it, expect } from "vitest";
import { codeChunks, compareBinCodes, sortPickRoute, sortBins, validateBinCode, locationsFor } from "@/lib/erp/bins";

describe("code chunks", () => {
  it("splits text and numbers so they compare properly", () => {
    expect(codeChunks("A-10-3")).toEqual(["A", 10, 3]);
    expect(codeChunks("AISLE 2")).toEqual(["AISLE", 2]);
    expect(codeChunks("7")).toEqual([7]);
  });
});

describe("walking order", () => {
  it("sorts A-2 before A-10 — the whole reason for a natural sort", () => {
    expect(compareBinCodes("A-2", "A-10")).toBeLessThan(0);
    expect(["A-10", "A-2", "A-1"].sort(compareBinCodes)).toEqual(["A-1", "A-2", "A-10"]);
  });

  it("orders aisle before rack before shelf", () => {
    const sorted = ["B-1-1", "A-2-5", "A-1-9", "A-2-1"].sort(compareBinCodes);
    expect(sorted).toEqual(["A-1-9", "A-2-1", "A-2-5", "B-1-1"]);
  });

  it("ignores separators and case, so A-1 and a_1 are the same place", () => {
    expect(compareBinCodes("A-1", "a_1")).toBe(0);
    expect(compareBinCodes("A 1", "A-1")).toBe(0);
  });

  it("puts a shorter prefix first", () => {
    expect(compareBinCodes("A", "A-1")).toBeLessThan(0);
  });
});

describe("pick route", () => {
  const line = (id: string, binCode: string | null) => ({ id, binCode });

  it("walks the warehouse in one pass", () => {
    const route = sortPickRoute([line("x", "B-1"), line("y", "A-10"), line("z", "A-2")]);
    expect(route.map((l) => l.id)).toEqual(["z", "y", "x"]);
  });

  it("leaves unlocated items to the end — hunt for them after the easy ones", () => {
    const route = sortPickRoute([line("nowhere", null), line("shelf", "A-1")]);
    expect(route.map((l) => l.id)).toEqual(["shelf", "nowhere"]);
  });

  it("keeps the input untouched", () => {
    const input = [line("x", "B-1"), line("y", "A-1")];
    sortPickRoute(input);
    expect(input.map((l) => l.id)).toEqual(["x", "y"]);
  });
});

describe("bin list", () => {
  it("reads in aisle order", () => {
    const bins = sortBins([{ id: "1", code: "A-10" }, { id: "2", code: "A-2" }]);
    expect(bins.map((b) => b.code)).toEqual(["A-2", "A-10"]);
  });
});

describe("code validation", () => {
  it("accepts an ordinary code", () => {
    expect(validateBinCode("A-1-3")).toBeNull();
  });

  it("refuses blank, punctuation-only and absurdly long codes", () => {
    expect(validateBinCode("")).toMatch(/مطلوب/);
    expect(validateBinCode("   ")).toMatch(/مطلوب/);
    expect(validateBinCode("---")).toMatch(/حرف أو رقم/);
    expect(validateBinCode("X".repeat(33))).toMatch(/٣٢/);
  });

  it("refuses a duplicate in the same warehouse, whatever the case", () => {
    expect(validateBinCode("a-1", ["A-1"])).toMatch(/مستخدم/);
    expect(validateBinCode("A-2", ["A-1"])).toBeNull();
  });
});

describe("where to find an item", () => {
  const bins = [{ id: "b1", code: "A-1" }, { id: "b2", code: "A-10" }, { id: "b3", code: "B-1" }];

  it("leads with the primary bin, then the rest in route order", () => {
    const found = locationsFor(
      [{ binId: "b3", isPrimary: false }, { binId: "b2", isPrimary: false }, { binId: "b1", isPrimary: true }],
      bins,
    );
    expect(found.map((b) => b.code)).toEqual(["A-1", "A-10", "B-1"]);
  });

  it("still lists everything when no bin is marked primary", () => {
    const found = locationsFor([{ binId: "b3", isPrimary: false }, { binId: "b1", isPrimary: false }], bins);
    expect(found.map((b) => b.code)).toEqual(["A-1", "B-1"]);
  });

  it("skips an assignment whose bin is gone", () => {
    expect(locationsFor([{ binId: "missing", isPrimary: true }], bins)).toEqual([]);
  });
});
