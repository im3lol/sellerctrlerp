/**
 * Quality inspection as a STAGE, not a flag.
 *
 * Goods for an inspected item are received into a quarantine warehouse: on the books at
 * their real cost, visible in the valuation, and impossible to sell — because they are
 * not in a warehouse anyone sells from. A pass moves them into available stock through
 * an ordinary transfer; a fail leaves them where they are, to be returned or scrapped as
 * its own decision.
 *
 * The alternative — a "quarantined" flag on stock that stays in the sellable warehouse —
 * needs every query in the system to remember to exclude it. One will forget.
 *
 * Pure — no db — so the decision arithmetic is testable.
 */

export type Decision = {
  quantity: number;
  passedQty: number;
  failedQty: number;
};

const round4 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 1e4) / 1e4;
const EPS = 1e-6;

/**
 * Validate a pass/fail split. Returns an Arabic error or null. The halves must add up to
 * what arrived: a split that loses two units silently leaves them in quarantine forever,
 * which is how a warehouse ends up with a corner nobody can explain.
 */
export function validateDecision(d: Decision): string | null {
  const total = Number(d.quantity) || 0;
  const passed = Number(d.passedQty) || 0;
  const failed = Number(d.failedQty) || 0;

  if (passed < 0 || failed < 0) return "الكميات مايكونوش بالسالب";
  if (passed + failed > total + EPS) return `المجموع (${round4(passed + failed)}) أكبر من الكمية المستلمة (${total})`;
  if (passed + failed < total - EPS) {
    return `فاضل ${round4(total - passed - failed)} غير محدَّد — اقبلها أو ارفضها، متسيبهاش في الحجر`;
  }
  if (passed + failed <= EPS) return "حدّد الكمية المقبولة أو المرفوضة";
  return null;
}

/** What a decision means for the two warehouses. */
export function decisionEffect(d: Decision): { release: number; hold: number } {
  return { release: round4(Math.max(0, Number(d.passedQty) || 0)), hold: round4(Math.max(0, Number(d.failedQty) || 0)) };
}

/** How the queue is doing — the number a buyer chases suppliers with. */
export function inspectionStats(
  rows: { status: string; quantity: number; passedQty: number; failedQty: number }[],
) {
  const decided = rows.filter((r) => r.status === "DECIDED");
  const arrived = decided.reduce((s, r) => s + Number(r.quantity), 0);
  const failed = decided.reduce((s, r) => s + Number(r.failedQty), 0);
  return {
    pending: rows.filter((r) => r.status === "PENDING").length,
    pendingQty: round4(rows.filter((r) => r.status === "PENDING").reduce((s, r) => s + Number(r.quantity), 0)),
    decided: decided.length,
    failRate: arrived > 0 ? Math.round((failed / arrived) * 1000) / 10 : null,
  };
}
