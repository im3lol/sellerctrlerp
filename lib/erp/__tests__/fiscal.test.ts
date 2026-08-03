import { describe, it, expect } from "vitest";
import { fiscalYearStartISO, fiscalYearBoundsFor } from "@/lib/erp/fiscal";

describe("fiscalYearStartISO", () => {
  it("empty setting = calendar year (Jan 1) — the safety default", () => {
    expect(fiscalYearStartISO(null, new Date(2026, 2, 10))).toBe("2026-01-01");
    expect(fiscalYearStartISO("", new Date(2026, 8, 10))).toBe("2026-01-01");
  });

  it("July fiscal start: current FY began last year before Jul, this year after", () => {
    expect(fiscalYearStartISO("2020-07-01", new Date(2026, 2, 10))).toBe("2025-07-01"); // March → prior FY
    expect(fiscalYearStartISO("2020-07-01", new Date(2026, 8, 10))).toBe("2026-07-01"); // Sept → current FY
    expect(fiscalYearStartISO("2020-07-01", new Date(2026, 6, 1))).toBe("2026-07-01");  // exactly Jul 1
  });

  it("only month/day of the stored date matter (year recurs)", () => {
    expect(fiscalYearStartISO("1999-04-01", new Date(2026, 5, 1))).toBe("2026-04-01");
  });

  it("Feb-29 start clamps to Feb-28 in non-leap years (never an invalid date)", () => {
    expect(fiscalYearStartISO("2024-02-29", new Date(2026, 5, 1))).toBe("2026-02-28"); // 2026 not leap
    expect(fiscalYearStartISO("2024-02-29", new Date(2028, 5, 1))).toBe("2028-02-29"); // 2028 leap
    expect(fiscalYearStartISO("2024-02-29", new Date(2025, 0, 15))).toBe("2024-02-29"); // prior year leap
  });

  it("malformed setting falls back to Jan 1", () => {
    expect(fiscalYearStartISO("garbage", new Date(2026, 5, 1))).toBe("2026-01-01");
  });
});

describe("fiscalYearBoundsFor", () => {
  const iso = (d: Date) => d.toISOString();

  it("empty setting = calendar year, byte-identical to the legacy bounds", () => {
    const b = fiscalYearBoundsFor(null, new Date(Date.UTC(2026, 5, 10)));
    expect(iso(b.startDate)).toBe(iso(new Date(Date.UTC(2026, 0, 1, 0, 0, 0))));
    expect(iso(b.endDate)).toBe(iso(new Date(Date.UTC(2026, 11, 31, 23, 59, 59))));
    expect(b.name).toBe("السنة المالية 2026");
  });

  it("July fiscal start → Jul 1 .. Jun 30, spans two years in the name", () => {
    // A date in September 2026 sits in the FY that began Jul 1 2026.
    const b = fiscalYearBoundsFor("2020-07-01", new Date(Date.UTC(2026, 8, 10)));
    expect(iso(b.startDate)).toBe(iso(new Date(Date.UTC(2026, 6, 1, 0, 0, 0))));
    expect(iso(b.endDate)).toBe(iso(new Date(Date.UTC(2027, 5, 30, 23, 59, 59))));
    expect(b.name).toBe("السنة المالية 2026/2027");
  });

  it("July fiscal start, a date before Jul → the FY that began last year", () => {
    const b = fiscalYearBoundsFor("2020-07-01", new Date(Date.UTC(2026, 2, 10))); // March 2026
    expect(iso(b.startDate)).toBe(iso(new Date(Date.UTC(2025, 6, 1, 0, 0, 0))));
    expect(iso(b.endDate)).toBe(iso(new Date(Date.UTC(2026, 5, 30, 23, 59, 59))));
    expect(b.name).toBe("السنة المالية 2025/2026");
  });

  it("adjacent fiscal years are contiguous and non-overlapping (no gap, no dupe)", () => {
    const a = fiscalYearBoundsFor("2020-07-01", new Date(Date.UTC(2026, 8, 1)));
    const next = fiscalYearBoundsFor("2020-07-01", new Date(Date.UTC(2027, 8, 1)));
    expect(next.startDate.getTime() - a.endDate.getTime()).toBe(1000); // exactly 1s apart
  });
});
