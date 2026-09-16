/**
 * Workflow automation — the pure half: what a rule is, what it can listen to and read,
 * how its conditions are judged. No database here; lib/erp/automation/engine.ts runs it.
 *
 * A rule is WHEN (a document event) → IF (conditions on that document's fields) → DO
 * (actions). The fields a condition can read are a fixed list per document — never free
 * SQL — so a rule can't reach anything its company doesn't own.
 */

export type AutoEvent =
  | "CREATE" | "CONFIRM" | "POST" | "CANCEL" | "REVERSE" | "DELETE" | "UPDATE"
  | "CONVERT" | "SUBMIT" | "APPROVE" | "REJECT";

export const EVENT_LABEL: Record<AutoEvent, string> = {
  CREATE: "اتعمل", CONFIRM: "اتأكد", POST: "اترحّل", CANCEL: "اتلغى", REVERSE: "اتعكس",
  DELETE: "اتمسح", UPDATE: "اتعدّل", CONVERT: "اتحوّل لمستند تاني", SUBMIT: "اتقدّم للموافقة",
  APPROVE: "اتوافق عليه", REJECT: "اترفضت موافقته",
};
export const isEvent = (e: string): e is AutoEvent => Object.hasOwn(EVENT_LABEL, e);

export type FieldType = "number" | "text" | "date";
type Col = { col: string; label: string; type: FieldType };

export type DocDef = {
  label: string;
  /** Detail route base; documents route by number. */
  path: string;
  table: string;
  /** Comments and follow-ups hang off the chatter kinds only (lib/erp/chatter.ts). */
  chatter: boolean;
  party?: { col: string; table: "customers" | "suppliers"; label: string };
  warehouse?: string;
  cols: Record<string, Col>;
};

const n = (col: string, label: string): Col => ({ col, label, type: "number" });
const t = (col: string, label: string): Col => ({ col, label, type: "text" });
const d = (col: string, label: string): Col => ({ col, label, type: "date" });
const base = { number: t("number", "الرقم"), status: t("status", "الحالة"), date: d("date", "التاريخ") };
const CUSTOMER = { col: "customer_id", table: "customers", label: "العميل" } as const;
const SUPPLIER = { col: "supplier_id", table: "suppliers", label: "المورد" } as const;

/** The documents a rule can listen to — table and column names checked against the schema. */
export const DOCS: Record<string, DocDef> = {
  SALES_ORDER: { label: "أمر بيع", path: "/sales/orders", table: "sales_orders", chatter: true, party: CUSTOMER,
    cols: { ...base, total: n("total_amount", "الإجمالي"), dueDate: d("due_date", "تاريخ الاستحقاق"), channel: t("channel", "القناة") } },
  QUOTATION: { label: "عرض سعر", path: "/sales/quotations", table: "sales_quotations", chatter: true, party: CUSTOMER,
    cols: { ...base, validUntil: d("valid_until", "ساري حتى") } },
  DELIVERY_NOTE: { label: "إذن صرف", path: "/sales/deliveries", table: "delivery_notes", chatter: true, party: CUSTOMER, warehouse: "warehouse_id",
    cols: { ...base } },
  SALES_INVOICE: { label: "فاتورة بيع", path: "/sales/invoices", table: "sales_invoices", chatter: true, party: CUSTOMER,
    cols: { ...base, total: n("total_amount", "الإجمالي"), balance: n("balance_due", "المتبقّي"), dueDate: d("due_date", "تاريخ الاستحقاق"), currency: t("currency_code", "العملة") } },
  SALES_RETURN: { label: "مرتجع بيع", path: "/sales/returns", table: "sales_returns", chatter: true, party: CUSTOMER, warehouse: "warehouse_id",
    cols: { ...base, total: n("total_amount", "الإجمالي"), channel: t("channel", "القناة"), reason: t("reason", "السبب") } },
  RECEIPT_VOUCHER: { label: "سند قبض", path: "/sales/receipts", table: "receipt_vouchers", chatter: true, party: CUSTOMER,
    cols: { ...base, total: n("amount", "المبلغ"), method: t("payment_method", "طريقة الدفع") } },
  PURCHASE_ORDER: { label: "أمر شراء", path: "/purchases/orders", table: "purchase_orders", chatter: true, party: SUPPLIER, warehouse: "warehouse_id",
    cols: { ...base, total: n("total_amount", "الإجمالي"), expectedDate: d("expected_date", "ميعاد الوصول"), currency: t("currency_code", "العملة") } },
  GOODS_RECEIPT: { label: "إذن استلام", path: "/purchases/receipts", table: "purchase_receipts", chatter: true, party: SUPPLIER, warehouse: "warehouse_id",
    cols: { ...base } },
  PURCHASE_INVOICE: { label: "فاتورة شراء", path: "/purchases/invoices", table: "purchase_invoices", chatter: true, party: SUPPLIER, warehouse: "warehouse_id",
    cols: { ...base, total: n("total_amount", "الإجمالي"), balance: n("balance_due", "المتبقّي"), dueDate: d("due_date", "تاريخ الاستحقاق"), currency: t("currency_code", "العملة") } },
  PURCHASE_RETURN: { label: "مرتجع شراء", path: "/purchases/returns", table: "purchase_returns", chatter: true, party: SUPPLIER, warehouse: "warehouse_id",
    cols: { ...base, total: n("total_amount", "الإجمالي") } },
  PAYMENT_VOUCHER: { label: "سند صرف", path: "/purchases/payments", table: "payment_vouchers", chatter: true, party: SUPPLIER,
    cols: { ...base, total: n("amount", "المبلغ"), method: t("payment_method", "طريقة الدفع") } },
  EXPENSE: { label: "مصروف", path: "/accounting/expenses", table: "expenses", chatter: false,
    cols: { ...base, total: n("amount", "المبلغ"), payee: t("payee", "المستفيد"), method: t("payment_method", "طريقة الدفع") } },
  STOCK_ADJUSTMENT: { label: "تسوية مخزون", path: "/inventory/adjustments", table: "stock_adjustments", chatter: true, warehouse: "warehouse_id",
    cols: { ...base, total: n("total_value", "القيمة"), reason: t("reason", "السبب") } },
  STOCK_TRANSFER: { label: "تحويل مخزون", path: "/inventory/transfers", table: "stock_transfers", chatter: true,
    cols: { ...base } },
  JOURNAL_ENTRY: { label: "قيد يومية", path: "/accounting/journal", table: "journal_entries", chatter: true,
    cols: { ...base, description: t("description", "البيان"), reference: t("reference", "المرجع"), source: t("source_type", "المصدر") } },
};

/** Every field a condition can read on a document: its own columns plus the party and warehouse names. */
export function fieldsOf(entity: string): { key: string; label: string; type: FieldType }[] {
  const def = DOCS[entity];
  if (!def) return [];
  const own = Object.entries(def.cols).map(([key, c]) => ({ key, label: c.label, type: c.type }));
  return [
    ...own,
    ...(def.party ? [{ key: "party", label: def.party.label, type: "text" as const }] : []),
    ...(def.warehouse ? [{ key: "warehouse", label: "المخزن", type: "text" as const }] : []),
  ];
}

export type Facts = Record<string, string | number | null>;

export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "notContains" | "empty" | "notEmpty";
export const OP_LABEL: Record<Op, string> = {
  eq: "يساوي", ne: "لا يساوي", gt: "أكبر من", gte: "أكبر من أو يساوي", lt: "أصغر من", lte: "أصغر من أو يساوي",
  contains: "فيه", notContains: "مافيهوش", empty: "فاضي", notEmpty: "مش فاضي",
};
export const OPS_FOR: Record<FieldType, Op[]> = {
  number: ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  text: ["eq", "ne", "contains", "notContains", "empty", "notEmpty"],
};

export type Condition = { field: string; op: Op; value?: string };

export type Recipients = { creator?: boolean; roles?: string[]; users?: string[] };
export type Action =
  | { type: "notify"; to: Recipients; message: string }
  | { type: "followUp"; assignee: string; inDays: number; summary: string } // assignee: "creator" or a user id
  | { type: "comment"; body: string }
  | { type: "webhook"; url: string; secret?: string };

export const ACTION_LABEL: Record<Action["type"], string> = {
  notify: "ابعت تنبيه", followUp: "اعمل متابعة", comment: "اكتب تعليق على المستند", webhook: "ابعت لنظام تاني (Webhook)",
};

export type Trigger = { kind: "event"; entity: string; event: AutoEvent };
export type RuleSpec = { trigger: Trigger; match: "all" | "any"; conditions: Condition[]; actions: Action[] };

/** A chain of rules triggering rules stops here. */
export const MAX_DEPTH = 3;

/** What the editor sees in place of a saved webhook secret — never the secret itself. */
export const SECRET_KEPT = "__kept__";
export const maskSpec = (s: RuleSpec): RuleSpec => ({
  ...s,
  actions: s.actions.map((a) => (a.type === "webhook" && a.secret ? { ...a, secret: SECRET_KEPT } : a)),
});

/** «لما أمر بيع اتأكد» — the rule's trigger as a sentence. */
export const describeTrigger = (t: Trigger) =>
  `لما ${DOCS[t.entity]?.label ?? t.entity} ${isEvent(t.event) ? EVENT_LABEL[t.event] : t.event}`;

const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const num = (v: unknown) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  return s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
};

export function checkCondition(c: Condition, facts: Facts, type: FieldType): boolean {
  const have = facts[c.field];
  const isEmpty = have == null || String(have).trim() === "";
  if (c.op === "empty") return isEmpty;
  if (c.op === "notEmpty") return !isEmpty;
  if (isEmpty) return c.op === "ne" || c.op === "notContains";

  if (type === "number") {
    const a = num(have), b = num(c.value);
    if (a == null || b == null) return false;
    switch (c.op) {
      case "eq": return a === b;
      case "ne": return a !== b;
      case "gt": return a > b;
      case "gte": return a >= b;
      case "lt": return a < b;
      case "lte": return a <= b;
      default: return false;
    }
  }
  // Dates are YYYY-MM-DD strings, so text order is date order.
  const a = type === "date" ? String(have).slice(0, 10) : lower(have);
  const b = type === "date" ? String(c.value ?? "").slice(0, 10) : lower(c.value);
  switch (c.op) {
    case "eq": return a === b;
    case "ne": return a !== b;
    case "contains": return a.includes(b);
    case "notContains": return !a.includes(b);
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
    default: return false;
  }
}

/** Does this document pass the rule's conditions? No conditions = every document. */
export function matches(spec: RuleSpec, facts: Facts): boolean {
  if (spec.conditions.length === 0) return true;
  const types = new Map(fieldsOf(spec.trigger.entity).map((f) => [f.key, f.type]));
  const results = spec.conditions.map((c) => checkCondition(c, facts, types.get(c.field) ?? "text"));
  return spec.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

/** «{number}» style placeholders → the document's values; unknown ones become empty. */
export function fill(template: string, facts: Facts, extra: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = k in extra ? extra[k] : facts[k];
    if (v == null) return "";
    return typeof v === "number" ? v.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 }) : String(v);
  });
}

export const PLACEHOLDERS = ["{doc}", "{number}", "{event}", "{party}", "{total}", "{status}", "{date}"];

/** Why a rule can't be saved, or null. */
export function validateSpec(spec: RuleSpec): string | null {
  const def = DOCS[spec.trigger?.entity];
  if (!def) return "اختار نوع المستند";
  if (!isEvent(spec.trigger.event)) return "اختار الحدث";
  const fields = new Map(fieldsOf(spec.trigger.entity).map((f) => [f.key, f.type]));
  if (spec.conditions.length > 10) return "عشرة شروط بالكتير";
  for (const c of spec.conditions) {
    const type = fields.get(c.field);
    if (!type) return "فيه شرط على حقل مش موجود في المستند ده";
    if (!OPS_FOR[type].includes(c.op)) return "فيه شرط بمقارنة ماتنفعش مع الحقل ده";
    if (c.op !== "empty" && c.op !== "notEmpty" && !String(c.value ?? "").trim()) return "فيه شرط من غير قيمة";
    if (type === "number" && c.op !== "empty" && c.op !== "notEmpty" && num(c.value) == null) return "قيمة الشرط لازم تكون رقم";
  }
  if (spec.actions.length === 0) return "ضيف إجراء واحد على الأقل";
  if (spec.actions.length > 10) return "عشرة إجراءات بالكتير";
  for (const a of spec.actions) {
    if (a.type === "notify") {
      if (!a.to.creator && !a.to.roles?.length && !a.to.users?.length) return "التنبيه محتاج حد يوصله";
      if (!a.message.trim() || a.message.length > 1000) return "اكتب نص التنبيه (لحد 1000 حرف)";
    } else if (a.type === "followUp") {
      if (!def.chatter) return `المتابعات مش متاحة على «${def.label}»`;
      if (!a.assignee) return "اختار مين المسؤول عن المتابعة";
      if (!Number.isInteger(a.inDays) || a.inDays < 0 || a.inDays > 365) return "موعد المتابعة بين 0 و365 يوم";
      if (!a.summary.trim() || a.summary.length > 500) return "اكتب المتابعة (لحد 500 حرف)";
    } else if (a.type === "comment") {
      if (!def.chatter) return `التعليقات مش متاحة على «${def.label}»`;
      if (!a.body.trim() || a.body.length > 2000) return "اكتب التعليق (لحد 2000 حرف)";
    } else if (a.type === "webhook") {
      let u: URL;
      try { u = new URL(a.url); } catch { return "رابط الـWebhook مش صحيح"; }
      if (u.protocol !== "https:") return "رابط الـWebhook لازم يبدأ بـ https";
    } else {
      return "إجراء غير معروف";
    }
  }
  return null;
}

/** Ready-made rules a company can switch on with one click. */
export type RuleTemplate = { key: string; title: string; description: string; spec: RuleSpec };
const ADMINS: Recipients = { roles: ["admin"] };
export const TEMPLATES: RuleTemplate[] = [
  { key: "big-sale", title: "أمر بيع كبير اتأكد", description: "تنبيه للمديرين لما أمر بيع فوق 50,000 يتأكد.",
    spec: { trigger: { kind: "event", entity: "SALES_ORDER", event: "CONFIRM" }, match: "all",
      conditions: [{ field: "total", op: "gt", value: "50000" }],
      actions: [{ type: "notify", to: ADMINS, message: "أمر بيع كبير اتأكد: {number} — {party} — {total}" }] } },
  { key: "cancelled-invoice", title: "فاتورة بيع اتلغت", description: "تنبيه للمديرين والمحاسبين بأي فاتورة بيع اتلغت.",
    spec: { trigger: { kind: "event", entity: "SALES_INVOICE", event: "CANCEL" }, match: "all", conditions: [],
      actions: [{ type: "notify", to: { roles: ["admin", "accountant"] }, message: "فاتورة بيع اتلغت: {number} — {party} — {total}" }] } },
  { key: "receipt-to-bill", title: "إذن استلام اتأكد ← سجّل فاتورة المورد", description: "متابعة للي عمل الإذن بعد يومين عشان فاتورة المورد ماتتنساش.",
    spec: { trigger: { kind: "event", entity: "GOODS_RECEIPT", event: "CONFIRM" }, match: "all", conditions: [],
      actions: [{ type: "followUp", assignee: "creator", inDays: 2, summary: "سجّل فاتورة المورد لإذن الاستلام {number} ({party})" }] } },
  { key: "quote-rejected", title: "عرض سعر اترفض ← كلّم العميل", description: "متابعة لصاحب العرض بعد يوم يتصل بالعميل يعرف السبب.",
    spec: { trigger: { kind: "event", entity: "QUOTATION", event: "UPDATE" }, match: "all",
      conditions: [{ field: "status", op: "eq", value: "REJECTED" }],
      actions: [{ type: "followUp", assignee: "creator", inDays: 1, summary: "العميل {party} رفض عرض السعر {number} — اتصل بيه واعرف السبب" }] } },
  { key: "big-payment", title: "سند صرف كبير", description: "تنبيه للمديرين بأي سند صرف فوق 20,000.",
    spec: { trigger: { kind: "event", entity: "PAYMENT_VOUCHER", event: "POST" }, match: "all",
      conditions: [{ field: "total", op: "gt", value: "20000" }],
      actions: [{ type: "notify", to: ADMINS, message: "سند صرف {number} للمورد {party} بمبلغ {total}" }] } },
  { key: "sales-return", title: "مرتجع بيع جديد", description: "تنبيه لأمناء المخزن بأي مرتجع بيع، وتعليق على المستند.",
    spec: { trigger: { kind: "event", entity: "SALES_RETURN", event: "CREATE" }, match: "all", conditions: [],
      actions: [
        { type: "notify", to: { roles: ["inventory"] }, message: "مرتجع بيع جديد {number} من {party} — جهّز استلامه" },
        { type: "comment", body: "اتبلّغ أمناء المخزن بالمرتجع تلقائياً." },
      ] } },
  { key: "reversed-entry", title: "قيد اتعكس", description: "تنبيه للمحاسبين بأي قيد اتعكس.",
    spec: { trigger: { kind: "event", entity: "JOURNAL_ENTRY", event: "REVERSE" }, match: "all", conditions: [],
      actions: [{ type: "notify", to: { roles: ["accountant", "admin"] }, message: "القيد {number} اتعكس — {description}" }] } },
  { key: "write-off", title: "تسوية مخزون بقيمة كبيرة", description: "تنبيه للمديرين بأي تسوية مخزون قيمتها فوق 5,000.",
    spec: { trigger: { kind: "event", entity: "STOCK_ADJUSTMENT", event: "CONFIRM" }, match: "all",
      conditions: [{ field: "total", op: "gt", value: "5000" }],
      actions: [{ type: "notify", to: ADMINS, message: "تسوية مخزون {number} بقيمة {total} — السبب: {reason}" }] } },
  { key: "po-approved", title: "أمر شراء اتوافق عليه", description: "تنبيه لصاحب أمر الشراء إن المدير وافق.",
    spec: { trigger: { kind: "event", entity: "PURCHASE_ORDER", event: "APPROVE" }, match: "all", conditions: [],
      actions: [{ type: "notify", to: { creator: true }, message: "المدير وافق على أمر الشراء {number} ({party}) — تقدر تكمّل" }] } },
  { key: "order-webhook", title: "ابعت كل أمر بيع مؤكَّد لنظام تاني", description: "Webhook لـZapier أو n8n أو Make مع كل أمر بيع يتأكد — حط الرابط بتاعك.",
    spec: { trigger: { kind: "event", entity: "SALES_ORDER", event: "CONFIRM" }, match: "all", conditions: [],
      actions: [{ type: "webhook", url: "https://example.com/webhook" }] } },
];
