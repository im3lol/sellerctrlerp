import { describe, it, expect } from "vitest";
import {
  toKg, toCm, parseMeasure, weightTextToKg, formatWeight, formatDimensionsCm, dimensionsTextToCm,
} from "@/lib/erp/units-convert";

describe("weight into kilograms", () => {
  it("converts the units a marketplace actually sends", () => {
    expect(toKg(0.37, "pounds")).toBe(0.168);
    expect(toKg(1, "lb")).toBe(0.454);
    expect(toKg(16, "oz")).toBe(0.454);
    expect(toKg(500, "g")).toBe(0.5);
    expect(toKg(2, "kg")).toBe(2);
  });

  it("does not care about case or a trailing full stop", () => {
    expect(toKg(1, "LBS")).toBe(0.454);
    expect(toKg(1, " Kg. ")).toBe(1);
  });

  it("refuses a unit it does not know rather than guessing", () => {
    // Guessing here would put a wrong weight into freight allocation, which is worse
    // than having none: the error would be invisible and spread across a shipment.
    expect(toKg(5, "stones")).toBeNull();
    expect(toKg(5, "")).toBeNull();
  });

  it("refuses a nonsense value", () => {
    expect(toKg(-1, "kg")).toBeNull();
    expect(toKg(Number.NaN, "kg")).toBeNull();
  });
});

describe("length into centimetres", () => {
  it("converts inches, feet and the metric family", () => {
    expect(toCm(1, "inch")).toBe(2.54);
    expect(toCm(9.055, "inches")).toBe(23);
    expect(toCm(1, "ft")).toBe(30.48);
    expect(toCm(10, "mm")).toBe(1);
    expect(toCm(1.5, "m")).toBe(150);
  });

  it("refuses an unknown unit", () => {
    expect(toCm(5, "cubits")).toBeNull();
  });
});

describe("reading a catalogue's free text", () => {
  it("splits the number from the unit", () => {
    expect(parseMeasure("0.37 pounds")).toEqual({ value: 0.37, unit: "pounds" });
    expect(parseMeasure("23cm")).toEqual({ value: 23, unit: "cm" });
  });

  it("reads a comma as a decimal point, but not as a thousands separator", () => {
    expect(parseMeasure("1,2 kg")?.value).toBe(1.2);
    expect(parseMeasure("1,234 g")?.value).toBe(1234);
  });

  it("returns nothing for a number with no unit — a bare figure means nothing", () => {
    expect(parseMeasure("0.37")).toBeNull();
    expect(parseMeasure("")).toBeNull();
    expect(parseMeasure(null)).toBeNull();
  });

  it("takes a whole weight string to kilograms in one step", () => {
    expect(weightTextToKg("0.37 pounds")).toBe(0.168);
    expect(weightTextToKg("340 g")).toBe(0.34);
    expect(weightTextToKg("0.37")).toBeNull();
  });
});

describe("how a weight reads", () => {
  it("uses grams below a kilo, because that is how it is bought", () => {
    expect(formatWeight(0.168)).toBe("168 جم");
    expect(formatWeight(0.999)).toBe("999 جم");
  });

  it("uses kilograms at a kilo and above", () => {
    expect(formatWeight(1)).toBe("1 كجم");
    expect(formatWeight(2.5)).toBe("2.5 كجم");
  });

  it("shows nothing at all rather than a zero weight", () => {
    expect(formatWeight(0)).toBeNull();
    expect(formatWeight(null)).toBeNull();
    expect(formatWeight(undefined)).toBeNull();
  });
});

describe("how a box reads", () => {
  it("states the unit once, at the end", () => {
    expect(formatDimensionsCm(2.54, 5.5, 23)).toBe("2.54 × 5.5 × 23 سم");
  });

  it("needs all three sides — two is not a box", () => {
    expect(formatDimensionsCm(2.54, 5.5, null)).toBeNull();
  });

  it("converts a whole catalogue string with one trailing unit", () => {
    expect(dimensionsTextToCm("0.039 × 2.165 × 9.055 inches")).toBe("0.1 × 5.5 × 23 سم");
    expect(dimensionsTextToCm("10 x 5 x 3 cm")).toBe("10 × 5 × 3 سم");
  });

  it("leaves alone a string it cannot read", () => {
    expect(dimensionsTextToCm("about the size of a shoebox")).toBeNull();
    expect(dimensionsTextToCm("10 × 5 × 3")).toBeNull();
    expect(dimensionsTextToCm(null)).toBeNull();
  });
});
