import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { countPendingDrafts } from "@/lib/erp/drafts";

export type Activity = { action: string; summary: string | null; number: string | null; at: string; href: string | null };
export type Notifications = {
  lowStock: number;
  expiring: number;
  overdueAR: number;
  overdueTotal: number;
  overdueAP: number;
  overdueAPTotal: number;
  pendingDrafts: number;
  newActivity: number;
  total: number;
  recent: Activity[];
};

// Entity type → detail route base (documents route by their readable number).
const ENTITY_PATH: Record<string, string> = {
  SALES_ORDER: "/sales/orders", SALES_INVOICE: "/sales/invoices", DELIVERY_NOTE: "/sales/deliveries",
  SALES_RETURN: "/sales/returns", PURCHASE_ORDER: "/purchases/orders", PURCHASE_INVOICE: "/purchases/invoices",
  GOODS_RECEIPT: "/purchases/receipts", PURCHASE_RETURN: "/purchases/returns", JOURNAL_ENTRY: "/accounting/journal",
};

/** Org-scoped notification counts + recent activity. Session-free so the daily
 *  cron can reuse it. `sinceIso` counts documents created after that instant. */
export async function computeNotifications(orgId: string, sinceIso?: string): Promise<Notifications> {
  const since = sinceIso ? new Date(sinceIso) : null;

  const [low, exp, ar, ap, activity, since_, drafts] = await Promise.all([
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (
        SELECT i.id FROM items i
        LEFT JOIN (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, number DESC
        ) l ON l.item_id = i.id
        WHERE i.organization_id = ${orgId} AND i.is_active = true AND coalesce(i.min_stock,0) > 0
        GROUP BY i.id
        HAVING coalesce(sum(l.balance_quantity),0) <= coalesce(i.min_stock,0)
      ) s`),
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM stock_batches
      WHERE organization_id = ${orgId} AND remaining_quantity > 0
        AND expiry_date IS NOT NULL AND expiry_date <= now() + interval '30 days'`),
    db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM sales_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`),
    db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM purchase_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`),
    db.select({ action: auditLogs.action, summary: auditLogs.summary, number: auditLogs.entityNumber, entityType: auditLogs.entityType, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"])))
      .orderBy(desc(auditLogs.createdAt)).limit(8),
    since
      ? db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
          .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"]), gt(auditLogs.createdAt, since)))
      : Promise.resolve([{ n: 0 }]),
    countPendingDrafts(orgId),
  ]);

  const lowStock = Number(low.rows[0]?.n ?? 0);
  const expiring = Number(exp.rows[0]?.n ?? 0);
  const overdueAR = Number(ar.rows[0]?.n ?? 0);
  const overdueTotal = Number(ar.rows[0]?.total ?? 0);
  const overdueAP = Number(ap.rows[0]?.n ?? 0);
  const overdueAPTotal = Number(ap.rows[0]?.total ?? 0);
  const newActivity = Number(since_[0]?.n ?? 0);
  const recent: Activity[] = activity.map((a) => {
    const base = ENTITY_PATH[a.entityType];
    return { action: a.action, summary: a.summary, number: a.number, at: a.at.toISOString(), href: base && a.number ? `${base}/${encodeURIComponent(a.number)}` : null };
  });
  return { lowStock, expiring, overdueAR, overdueTotal, overdueAP, overdueAPTotal, pendingDrafts: drafts, newActivity, total: lowStock + expiring + overdueAR + overdueAP + drafts + newActivity, recent };
}
