/**
 * Custody advances — money handed to an employee to spend for the company. The mirror
 * of an expense claim: there the employee pays first and is reimbursed, here the company
 * pays first and is accounted to afterwards.
 *
 * The arithmetic that matters is one number: what is still in that person's pocket and
 * unaccounted for. Everything below exists to keep that number honest — a settlement can
 * never account for more than was advanced, and the two halves of a settlement (what was
 * spent, what came back) must add up to what it claims to clear.
 *
 * Pure — no db — so the rules are testable.
 */

export type SettlementLine = { expenseAccountId: string; amount: number; description?: string | null };

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const EPS = 0.005; // half a piaster

/** Still in the employee's hands: advanced minus everything settled or returned. */
export function outstanding(amount: number, settledAmount: number): number {
  return round2(Number(amount || 0) - Number(settledAmount || 0));
}

/** What one settlement clears: real spending plus cash handed back. */
export function settlementTotal(lines: SettlementLine[], returnedAmount: number): number {
  const spent = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return round2(spent + (Number(returnedAmount) || 0));
}

export const spentTotal = (lines: SettlementLine[]): number =>
  round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));

/**
 * Validate a settlement against the advance it belongs to. Returns an Arabic error or
 * null. The ceiling is the point: accounting for more than was advanced means either the
 * employee spent their own money — which is an expense claim, a different document — or
 * somebody typed a number wrong.
 */
export function validateSettlement(input: {
  lines: SettlementLine[];
  returnedAmount: number;
  advanceAmount: number;
  alreadySettled: number;
}): string | null {
  const { lines, returnedAmount, advanceAmount, alreadySettled } = input;

  if (Number(returnedAmount) < 0) return "المبلغ المرتجع مايكونش بالسالب";
  for (const l of lines) {
    if (!l.expenseAccountId) return "اختر حساب المصروف في كل سطر";
    if (!Number.isFinite(Number(l.amount)) || Number(l.amount) <= 0) return "كل مبلغ لازم يكون أكبر من صفر";
  }

  const total = settlementTotal(lines, returnedAmount);
  if (total <= 0) return "أضف مصروفاً أو مبلغاً مرتجعاً";

  const left = outstanding(advanceAmount, alreadySettled);
  if (total > left + EPS) {
    return `التسوية (${total.toFixed(2)}) أكبر من الرصيد المتبقّي في العهدة (${left.toFixed(2)})`;
  }
  return null;
}

/** Whether this settlement closes the advance entirely. */
export function closesAdvance(input: {
  lines: SettlementLine[];
  returnedAmount: number;
  advanceAmount: number;
  alreadySettled: number;
}): boolean {
  const after = round2(Number(input.alreadySettled || 0) + settlementTotal(input.lines, input.returnedAmount));
  return after >= round2(Number(input.advanceAmount || 0)) - EPS;
}

/**
 * The journal for issuing an advance: the employee now owes the company this cash.
 * Returned as plain lines so the caller posts them through the normal engine.
 */
export function issueEntryLines(custodyAccountId: string, cashAccountId: string, amount: number, label: string) {
  const a = round2(amount);
  return [
    { accountId: custodyAccountId, debit: a, credit: 0, description: label },
    { accountId: cashAccountId, debit: 0, credit: a, description: label },
  ];
}

/**
 * The journal for a settlement: expenses take what was spent, cash takes back what was
 * returned, and the custody account is relieved of the whole amount.
 */
export function settlementEntryLines(
  custodyAccountId: string,
  cashAccountId: string,
  lines: SettlementLine[],
  returnedAmount: number,
  label: string,
) {
  const spent = spentTotal(lines);
  const returned = round2(returnedAmount);
  const out = lines.map((l) => ({
    accountId: l.expenseAccountId,
    debit: round2(l.amount),
    credit: 0,
    description: l.description?.trim() || label,
  }));
  if (returned > 0) out.push({ accountId: cashAccountId, debit: returned, credit: 0, description: `مرتجع عهدة — ${label}` });
  out.push({ accountId: custodyAccountId, debit: 0, credit: round2(spent + returned), description: label });
  return out;
}
