import { describe, it, expect } from "vitest";
import { capPayrollDeductions, inclusiveOverlapDays, unpaidLeaveDeduction } from "@/lib/erp/payroll-calc";

// The run balances iff gross === net + deductions + tax for every line.
const balances = (gross: number, tax: number, r: { deductions: number; net: number }) =>
  Math.abs(gross - (r.net + r.deductions + tax)) < 1e-9;

describe("capPayrollDeductions", () => {
  it("caps an over-deduction at gross so the line balances (net not < 0)", () => {
    const gross = 1000, tax = 0, ded = 1200;
    const r = capPayrollDeductions(gross, ded, tax);
    expect(r.net).toBe(0);
    expect(r.deductions).toBe(1000); // capped from 1200
    expect(balances(gross, tax, r)).toBe(true);
  });

  it("leaves a normal deduction untouched and balances", () => {
    const gross = 1000, tax = 100, ded = 200;
    const r = capPayrollDeductions(gross, ded, tax);
    expect(r.net).toBe(700);
    expect(r.deductions).toBe(200);
    expect(balances(gross, tax, r)).toBe(true);
  });

  it("caps deduction against gross net of tax", () => {
    const gross = 1000, tax = 300, ded = 900;
    const r = capPayrollDeductions(gross, ded, tax);
    expect(r.deductions).toBe(700); // gross - tax
    expect(r.net).toBe(0);
    expect(balances(gross, tax, r)).toBe(true);
  });
});

describe("inclusiveOverlapDays", () => {
  const d = (s: string) => new Date(s + "T00:00:00Z");
  it("clips a leave that pokes out of the period to the days inside it", () => {
    // Leave 30 Jul–5 Aug vs period 1–31 Jul → only 30 & 31 Jul count.
    expect(inclusiveOverlapDays(d("2026-07-30"), d("2026-08-05"), d("2026-07-01"), d("2026-07-31"))).toBe(2);
  });
  it("counts a fully-contained leave inclusively", () => {
    expect(inclusiveOverlapDays(d("2026-07-10"), d("2026-07-12"), d("2026-07-01"), d("2026-07-31"))).toBe(3);
  });
  it("returns 0 when disjoint", () => {
    expect(inclusiveOverlapDays(d("2026-06-01"), d("2026-06-10"), d("2026-07-01"), d("2026-07-31"))).toBe(0);
  });
  it("full period vs itself = period length", () => {
    expect(inclusiveOverlapDays(d("2026-07-01"), d("2026-07-31"), d("2026-07-01"), d("2026-07-31"))).toBe(31);
  });
});

describe("unpaidLeaveDeduction", () => {
  it("prorates monthly salary by unpaid days / period days", () => {
    // 3000 salary, 30-day period, 3 unpaid days → 300 deducted.
    expect(unpaidLeaveDeduction(3000, 3, 30)).toBe(300);
  });
  it("caps unpaid days at the period length", () => {
    expect(unpaidLeaveDeduction(3000, 40, 30)).toBe(3000);
  });
  it("returns 0 for no unpaid days or degenerate inputs", () => {
    expect(unpaidLeaveDeduction(3000, 0, 30)).toBe(0);
    expect(unpaidLeaveDeduction(3000, 5, 0)).toBe(0);
  });
});
