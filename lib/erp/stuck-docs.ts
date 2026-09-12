import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { ErpPermission } from "@/lib/erp/permissions";

export type StuckDoc = { id: string; label: string; number: string; href: string; why: string; days: number };

/**
 * Documents that should have moved on and haven't — one rule per kind. The clock starts at
 * created_at for drafts (a back-dated `date` would flag a draft typed in this morning) and
 * at the promised date for a purchase order.
 *
 * `from`/`since`/`where` are constants spliced with sql.raw — never user input.
 * ponytail: thresholds are fixed; move them into the org's settings when a tenant asks.
 */
const RULES: { perm: ErpPermission; label: string; path: string; why: string; days: number; from: string; since: string; where: string }[] = [
  { perm: "sales.view", label: "أمر بيع", path: "/sales/orders", why: "مؤكّد ولسه ماتشحنش", days: 3, from: "sales_orders", since: "created_at", where: "status IN ('CONFIRMED','PARTIALLY_DELIVERED')" },
  { perm: "sales.view", label: "إذن صرف", path: "/sales/deliveries", why: "مسودة لسه ماتأكدتش", days: 2, from: "delivery_notes", since: "created_at", where: "status = 'DRAFT'" },
  { perm: "sales.view", label: "فاتورة بيع", path: "/sales/invoices", why: "مسودة لسه ماتأكدتش", days: 2, from: "sales_invoices", since: "created_at", where: "status = 'DRAFT'" },
  { perm: "sales.view", label: "مرتجع منصة", path: "/sales/returns", why: "مستني قرارك (مخزن ولا تالف)", days: 7, from: "sales_returns", since: "created_at", where: "status = 'DRAFT' AND channel IS NOT NULL AND channel <> 'MANUAL'" },
  { perm: "purchases.view", label: "أمر شراء", path: "/purchases/orders", why: "عدّى موعد وصوله", days: 0, from: "purchase_orders", since: "expected_date", where: "status IN ('CONFIRMED','PARTIALLY_RECEIVED')" },
  { perm: "purchases.view", label: "فاتورة شراء", path: "/purchases/invoices", why: "مسودة لسه ماتأكدتش", days: 3, from: "purchase_invoices", since: "created_at", where: "status = 'DRAFT'" },
  { perm: "purchases.view", label: "طلب شراء", path: "/purchases/requisitions", why: "مستني حد يعتمده", days: 5, from: "material_requests", since: "created_at", where: "status = 'DRAFT'" },
  { perm: "accounting.view", label: "قيد", path: "/accounting/journal", why: "مسودة لسه ماترحّلش", days: 3, from: "journal_entries", since: "created_at", where: "status = 'DRAFT'" },
];

/** The stuck documents this member can see, oldest first. Call inside the org's RLS scope. */
export async function listStuckDocs(orgId: string, can: (p: ErpPermission) => boolean): Promise<StuckDoc[]> {
  const parts = RULES.filter((r) => can(r.perm)).map((r) => sql`
    SELECT id, number, ${r.label}::text AS label, ${r.path}::text AS path, ${r.why}::text AS why,
           floor(extract(epoch FROM now() - ${sql.raw(r.since)}) / 86400)::int AS days
    FROM ${sql.raw(r.from)}
    WHERE organization_id = ${orgId} AND ${sql.raw(r.where)}
      AND ${sql.raw(r.since)} < now() - make_interval(days => ${r.days})`);
  if (!parts.length) return [];
  const { rows } = await db.execute<Omit<StuckDoc, "href"> & { path: string }>(
    sql`${sql.join(parts, sql` UNION ALL `)} ORDER BY days DESC LIMIT 200`);
  return rows.map(({ path, ...r }) => ({ ...r, href: `${path}/${encodeURIComponent(r.number)}` }));
}
