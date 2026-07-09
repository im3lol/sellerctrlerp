import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Documents whose DRAFT status means "waiting for confirmation". All share the
// columns (number, date, status, organization_id) and route by number.
// ponytail: hardcoded table names (no user input) so sql.raw is safe.
export const DRAFT_DOCS = [
  { table: "sales_orders", label: "أمر بيع", path: "/erp/sales/orders" },
  { table: "sales_invoices", label: "فاتورة بيع", path: "/erp/sales/invoices" },
  { table: "delivery_notes", label: "إذن صرف", path: "/erp/sales/deliveries" },
  { table: "purchase_orders", label: "أمر شراء", path: "/erp/purchases/orders" },
  { table: "purchase_invoices", label: "فاتورة شراء", path: "/erp/purchases/invoices" },
  { table: "purchase_receipts", label: "إذن استلام", path: "/erp/purchases/receipts" },
  { table: "receipt_vouchers", label: "سند قبض", path: "/erp/sales/receipts" },
  { table: "payment_vouchers", label: "سند صرف", path: "/erp/purchases/payments" },
] as const;

export type DraftDoc = { number: string; label: string; path: string; date: Date };

export async function countPendingDrafts(orgId: string): Promise<number> {
  const parts = DRAFT_DOCS.map((d) => sql`SELECT count(*)::int AS c FROM ${sql.raw(d.table)} WHERE organization_id = ${orgId} AND status = 'DRAFT'`);
  const res = await db.execute<{ n: number }>(sql`SELECT coalesce(sum(c),0)::int AS n FROM (${sql.join(parts, sql` UNION ALL `)}) x`);
  return Number(res.rows[0]?.n ?? 0);
}

export async function getPendingDrafts(orgId: string): Promise<DraftDoc[]> {
  const parts = DRAFT_DOCS.map((d) => sql`SELECT number, date, ${d.label} AS label, ${d.path} AS path FROM ${sql.raw(d.table)} WHERE organization_id = ${orgId} AND status = 'DRAFT'`);
  const res = await db.execute<{ number: string; date: string; label: string; path: string }>(sql`${sql.join(parts, sql` UNION ALL `)} ORDER BY date DESC LIMIT 300`);
  return res.rows.map((r) => ({ number: r.number, label: r.label, path: r.path, date: new Date(r.date) }));
}
