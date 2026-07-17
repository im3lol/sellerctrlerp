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
