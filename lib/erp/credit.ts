/**
 * Customer credit exposure. Posting an invoice already refuses to take a customer past
 * their limit, but by then the goods are usually gone — the order was confirmed, the
 * warehouse picked it, and the only thing left is an argument. So the same rule is
 * applied one step earlier, at order confirmation, where saying no still costs nothing.
 *
 * Exposure is the receivable balance PLUS orders already confirmed and not yet invoiced.
 * Leaving those out would let a customer at their limit confirm ten more orders and only
 * discover the wall at the tenth invoice.
 *
 * Pure — no db — so the arithmetic is testable on its own.
 */

export type CreditInput = {
  /** Posted receivable balance (customers.balance). */
  balance: number;
  /** 0 (or less) means no limit is set — the customer is unlimited. */
  creditLimit: number;
  /** Value of this customer's CONFIRMED, not-yet-invoiced orders, excluding the one being confirmed. */
  openOrders: number;
  /** Value of the order being confirmed now. */
  orderTotal: number;
};

export type CreditVerdict =
  | { ok: true }
  | { ok: false; exposure: number; limit: number; excess: number };

const EPS = 1e-6;

/** Total the customer would owe if this order were confirmed. */
export function creditExposure(input: Pick<CreditInput, "balance" | "openOrders" | "orderTotal">): number {
  return Number(input.balance || 0) + Number(input.openOrders || 0) + Number(input.orderTotal || 0);
}

/** Whether confirming this order stays inside the customer's credit limit. */
export function creditVerdict(input: CreditInput): CreditVerdict {
  const limit = Number(input.creditLimit || 0);
  if (!(limit > 0)) return { ok: true }; // no limit set = unlimited, the existing convention
  const exposure = creditExposure(input);
  if (exposure <= limit + EPS) return { ok: true };
  return { ok: false, exposure, limit, excess: exposure - limit };
}

const egp = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The refusal, in the words a salesperson needs: who, how much over, and what the two
 * numbers are — not just "credit limit exceeded".
 */
export function creditError(customerName: string, v: Extract<CreditVerdict, { ok: false }>): string {
  return `تأكيد الأمر يتجاوز حد ائتمان «${customerName}»: المستحق بعد الأمر ${egp(v.exposure)} ج.م والحد ${egp(v.limit)} ج.م — زيادة ${egp(v.excess)} ج.م.`;
}
