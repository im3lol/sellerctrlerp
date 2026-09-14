/**
 * Manager approvals — the rules, with no database.
 *
 * One level, amount thresholds, per company. A document under its threshold confirms
 * as it always has; above it, someone holding `approvals.decide` has to say yes first.
 * The company that never turns this on sees no change at all — APPROVALS_OFF is what
 * every organization starts with.
 *
 * The reason string doubles as the approval's fingerprint. "قيمة أمر الشراء 30,000 فوق
 * الحد 25,000" is approved; edit the order to 32,000 and the reason changes, so the old
 * approval no longer covers it. That is the whole invalidation rule, and it needs no
 * snapshot of the document.
 */

export type ApprovalDocType =
  | "PURCHASE_ORDER"
  | "SALES_ORDER"
  | "STOCK_ADJUSTMENT"
  | "PAYMENT"
  | "EXPENSE"
  | "EXPENSE_CLAIM";

export type ApprovalPolicy = {
  enabled: boolean;
  /** Purchase order total above this needs approval. 0 = never. */
  purchaseOrder: number;
  /** An order-level discount above this percentage of the gross needs approval. 0 = never. */
  salesDiscountPct: number;
  /** Any sales line priced below its unit cost needs approval. */
  salesBelowCost: boolean;
  /** Stock value leaving the books (write-offs) above this needs approval. 0 = never. */
  stockWriteOff: number;
  /** A payment voucher above this needs approval. 0 = never. */
  payment: number;
  /** An expense or an employee's expense claim above this needs approval. 0 = never. */
  expense: number;
};

export const APPROVALS_OFF: ApprovalPolicy = {
  enabled: false, purchaseOrder: 0, salesDiscountPct: 0, salesBelowCost: false, stockWriteOff: 0, payment: 0, expense: 0,
};

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

/** Whatever is in organizations.approval_policy (null for most companies) → a full policy. */
export function parseApprovalPolicy(raw: unknown): ApprovalPolicy {
  if (!raw || typeof raw !== "object") return APPROVALS_OFF;
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    purchaseOrder: num(r.purchaseOrder),
    salesDiscountPct: Math.min(num(r.salesDiscountPct), 100),
    salesBelowCost: r.salesBelowCost === true,
    stockWriteOff: num(r.stockWriteOff),
    payment: num(r.payment),
    expense: num(r.expense),
  };
}

export type ApprovalFacts =
  | { docType: "PURCHASE_ORDER"; total: number }
  | { docType: "SALES_ORDER"; gross: number; discount: number; lines: { label: string; unitPrice: number; unitCost: number | null }[] }
  | { docType: "STOCK_ADJUSTMENT"; writeOff: number }
  | { docType: "PAYMENT"; amount: number }
  | { docType: "EXPENSE" | "EXPENSE_CLAIM"; amount: number };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
const EPS = 0.005;

function over(value: number, limit: number, what: string): string | null {
  return limit > 0 && value > limit + EPS ? `${what} ${fmt(value)} فوق الحد ${fmt(limit)}` : null;
}

/** Why this document needs a manager, or null when it doesn't. */
export function needsApproval(p: ApprovalPolicy, f: ApprovalFacts): string | null {
  if (!p.enabled) return null;
  switch (f.docType) {
    case "PURCHASE_ORDER": return over(f.total, p.purchaseOrder, "قيمة أمر الشراء");
    case "PAYMENT": return over(f.amount, p.payment, "قيمة الدفعة");
    case "EXPENSE":
    case "EXPENSE_CLAIM": return over(f.amount, p.expense, "قيمة المصروف");
    case "STOCK_ADJUSTMENT": return over(f.writeOff, p.stockWriteOff, "قيمة البضاعة الخارجة");
    case "SALES_ORDER": {
      const reasons: string[] = [];
      if (p.salesDiscountPct > 0 && f.gross > EPS) {
        const pct = (f.discount / f.gross) * 100;
        if (pct > p.salesDiscountPct + EPS) reasons.push(`خصم ${fmt(Math.round(pct * 10) / 10)}٪ فوق الحد ${fmt(p.salesDiscountPct)}٪`);
      }
      if (p.salesBelowCost) {
        // A line with no known cost (a service, or nothing ever received) can't be judged
        // below cost — it is not flagged rather than blocked on a guess.
        const under = f.lines.filter((l) => l.unitCost != null && l.unitCost > EPS && l.unitPrice < l.unitCost - EPS);
        if (under.length) reasons.push(`${fmt(under.length)} صنف بسعر أقل من التكلفة (${under[0].label}${under.length > 1 ? "…" : ""})`);
      }
      return reasons.length ? reasons.join(" · ") : null;
    }
  }
}

const rtf = new Intl.RelativeTimeFormat("ar-EG", { numeric: "auto" });
/** "منذ يومين" — how long a request has been waiting. Shared by the inbox (server) and
 *  the banner (client), so it lives here rather than in a "use client" file. */
export function timeAgo(d: string | Date): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "الآن";
  const m = Math.round(s / 60); if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60); if (h < 24) return rtf.format(-h, "hour");
  return rtf.format(-Math.round(h / 24), "day");
}

/**
 * May this person decide this request? Separation of duties: whoever asked can't approve
 * their own request — except an admin (the owner), so a one-person company is never
 * locked out of its own documents.
 */
export function decisionBlocked(input: {
  requestedBy: string | null;
  deciderId: string;
  deciderRole: string;
  deciderCanDecide: boolean;
}): string | null {
  if (!input.deciderCanDecide) return "ليس لديك صلاحية الاعتماد";
  if (input.requestedBy && input.requestedBy === input.deciderId && input.deciderRole !== "admin") {
    return "مينفعش تعتمد طلب إنت اللي عامله — لازم مدير تاني";
  }
  return null;
}

/**
 * Can the person confirming skip the queue? Only an admin who may decide — the same
 * person could approve it a second later anyway, so making them click twice is friction
 * with no control in it. Everyone else goes through a request.
 */
export function canSelfApprove(role: string, canDecide: boolean): boolean {
  return canDecide && role === "admin";
}

/**
 * «المتأخر» — after how many days each kind of open document counts as stuck
 * (lib/erp/stuck-docs.ts). Stored with the approvals in organizations.approval_policy
 * under `stuck`; whatever a company leaves blank keeps the default. The purchase order is
 * counted from its promised arrival date, everything else from when it was created.
 */
export type StuckKey = "so" | "dn" | "si" | "ret" | "unrec" | "po" | "pi" | "mr" | "je";

export const STUCK_RULES: { key: StuckKey; label: string; def: number }[] = [
  { key: "so", label: "أمر بيع مؤكد ولسه ماتشحنش", def: 3 },
  { key: "dn", label: "إذن صرف مسودة", def: 2 },
  { key: "si", label: "فاتورة بيع مسودة", def: 2 },
  { key: "ret", label: "مرتجع منصة مستني قرارك", def: 7 },
  { key: "unrec", label: "مرتجع ماوصلش ومفيش تعويض", def: 30 },
  { key: "po", label: "أمر شراء بعد موعد وصوله", def: 0 },
  { key: "pi", label: "فاتورة شراء مسودة", def: 3 },
  { key: "mr", label: "طلب شراء مستني اعتماد", def: 5 },
  { key: "je", label: "قيد مسودة", def: 3 },
];

export type StuckDays = Record<StuckKey, number>;

/** organizations.approval_policy → the days for every rule (0..365, whole days). */
export function parseStuckDays(raw: unknown): StuckDays {
  const set = raw && typeof raw === "object" ? (raw as Record<string, unknown>).stuck : null;
  const s = set && typeof set === "object" ? (set as Record<string, unknown>) : {};
  const out = {} as StuckDays;
  for (const { key, def } of STUCK_RULES) {
    const v = s[key];
    const n = Number(v);
    out[key] = v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n >= 0 ? Math.min(Math.trunc(n), 365) : def;
  }
  return out;
}
