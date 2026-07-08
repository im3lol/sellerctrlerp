import { describe, it, expect } from "vitest";
import { parseDate } from "../dates";

describe("parseDate", () => {
  it("parses a valid ISO date", () => {
    const d = parseDate("2026-06-30");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getUTCFullYear()).toBe(2026);
  });
  it("returns null for missing input", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });
  it("returns null for invalid dates (the crash-guard)", () => {
    expect(parseDate("garbage")).toBeNull();
    expect(parseDate("2026-13-45")).toBeNull();
    expect(parseDate("not-a-date")).toBeNull();
  });
});
