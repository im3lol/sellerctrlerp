/**
 * Sales commission. The whole question is *when* it is earned, and the answer this
 * system defaults to is: when the customer pays, not when the invoice is issued.
 * Commission on an invoice that is never collected is money out for a sale that never
 * really happened — and the rep who chases payment is the one who earned it.
 *
 * Both bases are supported because some businesses genuinely pay on invoicing; what the
 * code refuses to do is quietly mix them, or pay twice on the same money.
 *
 * Pure — no db — so the earning rule is testable.
 */

export type Basis = "COLLECTED" | "INVOICED";

export type Rule = {
  employeeId: string | null; // null = the org's default rule
  basis: Basis;
  percent: number;
  validFrom?: string | Date | null;
  validTo?: string | Date | null;
  isActive?: boolean;
};

export type InvoiceFact = {
  id: string;
  number: string;
  salesRepId: string | null;
  customerName: string;
  date: string | Date;
  /** Invoice total, net of returns. */
  amount: number;
};

export type ReceiptFact = {
  id: string;
  number: string;
  salesInvoiceId: string | null;
  date: string | Date;
  amount: number;
};

export type EarnedRow = {
  repId: string;
  /** The document the commission was earned on — an invoice or a receipt. */
  sourceType: "INVOICE" | "RECEIPT";
  sourceId: string;
  sourceNumber: string;
  customerName: string;
  date: string;
  base: number;
  percent: number;
  commission: number;
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ts = (v: string | Date | null | undefined): number | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

const iso = (v: string | Date): string => new Date(v).toISOString().slice(0, 10);

/**
 * The rule that applies to one rep on one date: their own if it covers the date,
 * otherwise the org default. Returns null when neither applies — and a rep with no rule
 * earns nothing rather than silently falling back to some other rep's percentage.
 */
export function ruleFor(rules: Rule[], employeeId: string, on: string | Date): Rule | null {
  const t = ts(on);
  const applies = (r: Rule) => {
    if (r.isActive === false) return false;
    const from = ts(r.validFrom);
    const to = ts(r.validTo);
    if (t == null) return true;
    if (from != null && t < from) return false;
    // validTo covers its whole day.
    if (to != null && t > to + 86_399_999) return false;
    return true;
  };
  const own = rules.find((r) => r.employeeId === employeeId && applies(r));
  if (own) return own;
  return rules.find((r) => r.employeeId == null && applies(r)) ?? null;
}

/**
 * What each rep earned in a period.
 *
 * On the COLLECTED basis a receipt only earns commission when it can be traced to an
 * invoice with a rep on it: a payment on account, with no invoice, belongs to nobody in
 * particular, and guessing would pay someone for a sale that may not be theirs.
 */
export function computeCommissions(
  rules: Rule[],
  invoices: InvoiceFact[],
  receipts: ReceiptFact[],
): EarnedRow[] {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const rows: EarnedRow[] = [];

  for (const inv of invoices) {
    if (!inv.salesRepId) continue;
    const rule = ruleFor(rules, inv.salesRepId, inv.date);
    if (!rule || rule.basis !== "INVOICED" || !(rule.percent > 0)) continue;
    rows.push({
      repId: inv.salesRepId, sourceType: "INVOICE", sourceId: inv.id, sourceNumber: inv.number,
      customerName: inv.customerName, date: iso(inv.date),
      base: round2(inv.amount), percent: rule.percent,
      commission: round2(inv.amount * (rule.percent / 100)),
    });
  }

  for (const rec of receipts) {
    if (!rec.salesInvoiceId) continue;
    const inv = invoiceById.get(rec.salesInvoiceId);
    if (!inv?.salesRepId) continue;
    const rule = ruleFor(rules, inv.salesRepId, rec.date);
    if (!rule || rule.basis !== "COLLECTED" || !(rule.percent > 0)) continue;
    rows.push({
      repId: inv.salesRepId, sourceType: "RECEIPT", sourceId: rec.id, sourceNumber: rec.number,
      customerName: inv.customerName, date: iso(rec.date),
      base: round2(rec.amount), percent: rule.percent,
      commission: round2(rec.amount * (rule.percent / 100)),
    });
  }

  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Per-rep totals for the top of the report. */
export function summarise(rows: EarnedRow[]): { repId: string; base: number; commission: number; count: number }[] {
  const by = new Map<string, { repId: string; base: number; commission: number; count: number }>();
  for (const r of rows) {
    const cur = by.get(r.repId) ?? { repId: r.repId, base: 0, commission: 0, count: 0 };
    cur.base = round2(cur.base + r.base);
    cur.commission = round2(cur.commission + r.commission);
    cur.count++;
    by.set(r.repId, cur);
  }
  return [...by.values()].sort((a, b) => b.commission - a.commission);
}

/** Validate a rule before saving. Returns an Arabic error or null. */
export function validateRule(input: { percent: number; basis: string; validFrom?: string | null; validTo?: string | null }): string | null {
  const p = Number(input.percent);
  if (!Number.isFinite(p) || p < 0) return "النسبة لازم تكون صفر أو أكبر";
  // A commission over 100% of the sale is a typo every time it is seen.
  if (p > 100) return "النسبة أكبر من ١٠٠٪ — غالباً خطأ كتابة";
  if (input.basis !== "COLLECTED" && input.basis !== "INVOICED") return "أساس العمولة غير معروف";
  const from = ts(input.validFrom);
  const to = ts(input.validTo);
  if (from != null && to != null && to < from) return "تاريخ النهاية قبل البداية";
  return null;
}

export const BASIS_LABEL: Record<Basis, string> = {
  COLLECTED: "على المُحصَّل",
  INVOICED: "على المفوتر",
};
