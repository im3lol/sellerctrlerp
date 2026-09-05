/**
 * Point of sale: the till's own arithmetic. Two things have to be exactly right, and
 * both are here rather than in a form handler.
 *
 * The payment split, because a sale that is a piastre short posts a wrong invoice and
 * the drawer disagrees with the books forever after. And the shift reconciliation,
 * because "the drawer is 40 short" is the entire reason a shift exists.
 *
 * A POS sale is an ordinary sales invoice — this file never touches stock or the ledger.
 *
 * Pure — no db — so both are testable.
 */

export type PaymentMethod = "CASH" | "CARD" | "WALLET" | "VOUCHER";

export type Payment = { method: PaymentMethod; amount: number; reference?: string | null };

export type CartLine = {
  itemId: string;
  quantity: number;
  unitPrice: number;
  /** Per-line discount in money, not percent — what the cashier actually keys. */
  discount?: number;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const EPS = 0.005; // half a piastre

/** Cart totals. Tax is applied to the discounted subtotal, the way the invoice does it. */
export function cartTotals(lines: CartLine[], vatRate = 0, applyVat = false) {
  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0));
  const discount = round2(lines.reduce((s, l) => s + (Number(l.discount) || 0), 0));
  const net = round2(subtotal - discount);
  const tax = applyVat && vatRate > 0 ? round2(net * (vatRate / 100)) : 0;
  return { subtotal, discount, net, tax, total: round2(net + tax) };
}

export const paymentsTotal = (payments: Payment[]): number =>
  round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0));

/** Cash tendered above the total — what the cashier hands back. */
export function changeDue(total: number, payments: Payment[]): number {
  const cash = payments.filter((p) => p.method === "CASH").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const nonCash = payments.filter((p) => p.method !== "CASH").reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return round2(Math.max(0, cash + nonCash - Number(total)));
}

/**
 * Validate a payment split. Returns an Arabic error or null.
 *
 * Only CASH may exceed the total, and only because the customer handed over a bigger
 * note — the difference is change, not revenue. A card or wallet that overpays is
 * somebody typing into the wrong box, and taking it would post an invoice that never
 * matches the settlement.
 */
export function validatePayments(total: number, payments: Payment[]): string | null {
  const t = round2(total);
  if (t <= 0) return "الفاتورة فاضية";
  if (!payments.length) return "أدخل طريقة دفع واحدة على الأقل";
  if (payments.some((p) => !(Number(p.amount) > 0))) return "كل مبلغ لازم يكون أكبر من صفر";

  const paid = paymentsTotal(payments);
  if (paid < t - EPS) return `الباقي ${round2(t - paid).toFixed(2)} لسه مدفوعش`;

  const nonCash = round2(payments.filter((p) => p.method !== "CASH").reduce((s, p) => s + Number(p.amount), 0));
  if (nonCash > t + EPS) return "المدفوع بالبطاقة/المحفظة أكبر من الفاتورة — الفكة كاش بس";
  return null;
}

/** What the invoice records as received: the total, never the change. */
export function appliedPayments(total: number, payments: Payment[]): Payment[] {
  const t = round2(total);
  const nonCash = payments.filter((p) => p.method !== "CASH");
  const nonCashTotal = round2(nonCash.reduce((s, p) => s + Number(p.amount), 0));
  const cashNeeded = round2(Math.max(0, t - nonCashTotal));
  return cashNeeded > EPS ? [...nonCash, { method: "CASH" as const, amount: cashNeeded }] : nonCash;
}

export type ShiftPayment = { method: PaymentMethod; amount: number };

/**
 * Close-of-shift reconciliation. Only cash should be in the drawer; card and wallet land
 * with the bank, so counting them here would invent a shortage every single shift.
 */
export function reconcileShift(input: {
  openingFloat: number;
  payments: ShiftPayment[];
  refundsCash?: number;
  countedCash: number;
}) {
  const byMethod = new Map<PaymentMethod, number>();
  for (const p of input.payments) {
    byMethod.set(p.method, round2((byMethod.get(p.method) ?? 0) + (Number(p.amount) || 0)));
  }
  const cashSales = byMethod.get("CASH") ?? 0;
  const expected = round2(Number(input.openingFloat || 0) + cashSales - Number(input.refundsCash || 0));
  const counted = round2(Number(input.countedCash) || 0);
  return {
    byMethod: Object.fromEntries(byMethod) as Partial<Record<PaymentMethod, number>>,
    cashSales,
    expected,
    counted,
    /** Positive is a surplus in the drawer, negative a shortage. */
    difference: round2(counted - expected),
    totalSales: round2(input.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
  };
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "كاش",
  CARD: "بطاقة",
  WALLET: "محفظة إلكترونية",
  VOUCHER: "قسيمة",
};
