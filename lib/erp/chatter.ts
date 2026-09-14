import type { ErpPermission } from "@/lib/erp/permissions";

/**
 * Conversation on documents — the rules, with no database (the client imports this).
 *
 * `kind` is the stable key a comment or follow-up is filed under. It carries what the
 * server needs (who may read and write: whoever may view the document) and what a
 * notification needs (a label and where the document lives).
 */
export const CHATTER_DOCS = {
  SALES_ORDER: { label: "أمر بيع", path: "/sales/orders", perm: "sales.view" },
  QUOTATION: { label: "عرض سعر", path: "/sales/quotations", perm: "sales.view" },
  DELIVERY_NOTE: { label: "إذن صرف", path: "/sales/deliveries", perm: "sales.view" },
  SALES_INVOICE: { label: "فاتورة بيع", path: "/sales/invoices", perm: "sales.view" },
  SALES_RETURN: { label: "مرتجع بيع", path: "/sales/returns", perm: "sales.view" },
  RECEIPT_VOUCHER: { label: "سند قبض", path: "/sales/receipts", perm: "sales.view" },
  PURCHASE_ORDER: { label: "أمر شراء", path: "/purchases/orders", perm: "purchases.view" },
  GOODS_RECEIPT: { label: "إذن استلام", path: "/purchases/receipts", perm: "purchases.view" },
  PURCHASE_INVOICE: { label: "فاتورة شراء", path: "/purchases/invoices", perm: "purchases.view" },
  PURCHASE_RETURN: { label: "مرتجع شراء", path: "/purchases/returns", perm: "purchases.view" },
  PAYMENT_VOUCHER: { label: "سند صرف", path: "/purchases/payments", perm: "purchases.view" },
  LANDED_COST: { label: "تكاليف استيراد", path: "/purchases/landed-costs", perm: "purchases.view" },
  JOURNAL_ENTRY: { label: "قيد", path: "/accounting/journal", perm: "accounting.view" },
  STOCK_ADJUSTMENT: { label: "تسوية مخزون", path: "/inventory/adjustments", perm: "inventory.view" },
  STOCK_TRANSFER: { label: "تحويل مخزون", path: "/inventory/transfers", perm: "inventory.view" },
} as const satisfies Record<string, { label: string; path: string; perm: ErpPermission }>;

export type ChatterKind = keyof typeof CHATTER_DOCS;

export const isChatterKind = (k: string): k is ChatterKind => Object.hasOwn(CHATTER_DOCS, k);

export const docHref = (kind: ChatterKind, number: string) => `${CHATTER_DOCS[kind].path}/${encodeURIComponent(number)}`;

export type FollowUpState = "done" | "overdue" | "today" | "soon";

/** Where a follow-up stands, from its due date (yyyy-mm-dd) and today's date (yyyy-mm-dd). */
export function followUpState(dueDate: string, doneAt: string | null, today: string): FollowUpState {
  if (doneAt) return "done";
  if (dueDate < today) return "overdue";
  return dueDate === today ? "today" : "soon";
}

/** Today's date as yyyy-mm-dd in Cairo — "due today" means today where the company works.
 *  ponytail: Cairo for every tenant; read the org's timezone when one isn't Egyptian. */
export const cairoToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
