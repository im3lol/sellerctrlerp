import { describe, it, expect } from "vitest";
import { formatErpDate, formatErpDateTime, parseDate } from "../dates";

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

describe("ERP display timezone", () => {
  it("keeps SSR and browser dates identical across host timezones near midnight", () => {
    const previous = process.env.TZ;
    try {
      for (const zone of ["UTC", "Africa/Cairo", "America/Los_Angeles"]) {
        process.env.TZ = zone;
        expect(formatErpDate("2026-10-23T23:30:00Z", "en-GB", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("24/10/2026");
        expect(formatErpDateTime("2026-10-23T23:30:00Z", "en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("24/10/2026, 02:30");
      }
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it("uses Cairo winter offset and preserves ISO document calendar dates", () => {
    expect(formatErpDateTime("2026-12-12T23:30:00Z", "en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("01:30");
    expect(formatErpDate("2026-10-24", "en-GB", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("24/10/2026");
  });
});
