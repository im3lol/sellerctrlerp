import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import type { ErpPermission } from "@/lib/erp/permissions";
import { parseStuckDays, type StuckKey } from "@/lib/erp/approval-policy";

export type StuckDoc = { id: string; label: string; number: string; href: string; why: string; days: number };

/**
 * Documents that should have moved on and haven't — one rule per kind. How many days
 * count as "too long" is each company's own setting (STUCK_RULES in approval-policy.ts,
 * edited in Settings). The clock starts at created_at for drafts (a back-dated `date`
 * would flag a draft typed in this morning) and at the promised date for a purchase order.
 *
 * `from`/`since`/`where` are constants spliced with sql.raw — never user input.
 */
const RULES: { key: StuckKey; perm: ErpPermission; label: string; path: string; why: string; from: string; since: string; where: string }[] = [
  { key: "so", perm: "sales.view", label: "أمر بيع", path: "/sales/orders", why: "مؤكّد ولسه ماتشحنش", from: "sales_orders", since: "created_at", where: "status IN ('CONFIRMED','PARTIALLY_DELIVERED')" },
  { key: "dn", perm: "sales.view", label: "إذن صرف", path: "/sales/deliveries", why: "مسودة لسه ماتأكدتش", from: "delivery_notes", since: "created_at", where: "status = 'DRAFT'" },
  { key: "si", perm: "sales.view", label: "فاتورة بيع", path: "/sales/invoices", why: "مسودة لسه ماتأكدتش", from: "sales_invoices", since: "created_at", where: "status = 'DRAFT'" },
  { key: "ret", perm: "sales.view", label: "مرتجع منصة", path: "/sales/returns", why: "مستني قرارك (مخزن ولا تالف)", from: "sales_returns", since: "created_at", where: "status = 'DRAFT' AND channel IS NOT NULL AND channel <> 'MANUAL'" },
  // The customer sent it back but the platform never forwarded it, and no reimbursement has
  // come in for that order: time to open a claim. Leaves the list by itself the moment a
  // reimbursement for the order is pulled in.
  { key: "unrec", perm: "sales.view", label: "مرتجع ماوصلش", path: "/sales/returns", why: "ماوصلكش ومفيش تعويض — افتح مطالبة عند المنصة",
    from: "(SELECT sr.id, sr.number, sr.organization_id, sr.date AS since FROM platform_returns pr JOIN sales_returns sr ON sr.id = pr.sales_return_id WHERE pr.status = 'NOT_RECEIVED' AND NOT EXISTS (SELECT 1 FROM fba_reimbursements f WHERE f.organization_id = pr.organization_id AND f.order_id = pr.order_id)) x",
    since: "since", where: "true" },
  { key: "po", perm: "purchases.view", label: "أمر شراء", path: "/purchases/orders", why: "عدّى موعد وصوله", from: "purchase_orders", since: "expected_date", where: "status IN ('CONFIRMED','PARTIALLY_RECEIVED')" },
  { key: "pi", perm: "purchases.view", label: "فاتورة شراء", path: "/purchases/invoices", why: "مسودة لسه ماتأكدتش", from: "purchase_invoices", since: "created_at", where: "status = 'DRAFT'" },
  { key: "mr", perm: "purchases.view", label: "طلب شراء", path: "/purchases/requisitions", why: "مستني حد يعتمده", from: "material_requests", since: "created_at", where: "status = 'DRAFT'" },
  { key: "je", perm: "accounting.view", label: "قيد", path: "/accounting/journal", why: "مسودة لسه ماترحّلش", from: "journal_entries", since: "created_at", where: "status = 'DRAFT'" },
];

/** The stuck documents this member can see, oldest first. Call inside the org's RLS scope. */
export async function listStuckDocs(orgId: string, can: (p: ErpPermission) => boolean): Promise<StuckDoc[]> {
  const rules = RULES.filter((r) => can(r.perm));
  if (!rules.length) return [];
  const [org] = await db.select({ p: organizations.approvalPolicy }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const days = parseStuckDays(org?.p);
  const parts = rules.map((r) => sql`
    SELECT id, number, ${r.label}::text AS label, ${r.path}::text AS path, ${r.why}::text AS why,
           floor(extract(epoch FROM now() - ${sql.raw(r.since)}) / 86400)::int AS days
    FROM ${sql.raw(r.from)}
    WHERE organization_id = ${orgId} AND ${sql.raw(r.where)}
      AND ${sql.raw(r.since)} < now() - make_interval(days => ${days[r.key]})`);
  const { rows } = await db.execute<Omit<StuckDoc, "href"> & { path: string }>(
    sql`${sql.join(parts, sql` UNION ALL `)} ORDER BY days DESC LIMIT 200`);
  return rows.map(({ path, ...r }) => ({ ...r, href: `${path}/${encodeURIComponent(r.number)}` }));
}
