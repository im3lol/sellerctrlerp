import { describe, it, expect } from "vitest";
import { fiscalYearStartISO } from "@/lib/erp/fiscal";

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
});
