import { round2 } from "@/lib/erp/money";

// Cap total deductions (manual deductions + tax) at gross pay. Otherwise, when an
// employee's deductions exceed gross, netPay clamps to 0 while the deduction total
// still counts the full amount — so gross ≠ net + deductions and the run's confirm
// journal entry (debit gross / credit net+deductions) is unbalanced and can't post,
// blocking the ENTIRE run. Capping keeps the identity gross = net + deductions + tax.
export function capPayrollDeductions(gross: number, deductions: number, tax: number) {
  const cappedDeductions = Math.min(Math.max(0, deductions), Math.max(0, round2(gross - tax)));
  const net = round2(gross - tax - cappedDeductions);
  return { deductions: cappedDeductions, net };
}

const MS_PER_DAY = 86_400_000;
const dayIndex = (d: Date) =>
  Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);

// Inclusive calendar-day overlap between two [start,end] date ranges. Both leave
// spans and payroll periods store inclusive calendar days, so a leave that pokes out
// of the period only counts the days that fall inside it. Returns 0 when disjoint.
export function inclusiveOverlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(dayIndex(aStart), dayIndex(bStart));
  const e = Math.min(dayIndex(aEnd), dayIndex(bEnd));
  return e >= s ? e - s + 1 : 0;
}

// Prorate a MONTHLY salary for approved unpaid-leave days: deduct
// salary × (unpaidDays / periodDays). Calendar-day basis on both numerator and
// denominator so they stay consistent (working-day refinement — excluding weekends/
// holidays from both — can come later; ponytail: calendar days is correct and simple).
export function unpaidLeaveDeduction(monthlySalary: number, unpaidDays: number, periodDays: number): number {
  if (periodDays <= 0 || unpaidDays <= 0 || monthlySalary <= 0) return 0;
  return round2((monthlySalary * Math.min(unpaidDays, periodDays)) / periodDays);
}
