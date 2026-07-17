import { describe, it, expect } from "vitest";
import { capPayrollDeductions } from "@/lib/erp/payroll-calc";

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
