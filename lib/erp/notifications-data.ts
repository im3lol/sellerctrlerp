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
  stockWaiting: number;
  newActivity: number;
  newOrders: number;
  needsReview: number;
  total: number;
  recent: Activity[];
};

// Entity type → detail route base (documents route by their readable number).
const ENTITY_PATH: Record<string, string> = {
  SALES_ORDER: "/sales/orders", SALES_INVOICE: "/sales/invoices", DELIVERY_NOTE: "/sales/deliveries",
  SALES_RETURN: "/sales/returns", PURCHASE_ORDER: "/purchases/orders", PURCHASE_INVOICE: "/purchases/invoices",
  GOODS_RECEIPT: "/purchases/receipts", PURCHASE_RETURN: "/purchases/returns", JOURNAL_ENTRY: "/accounting/journal",
};

// Recent-activity entity type → the ERP permission needed to see it.
const ENTITY_PERM: Record<string, string> = {
  SALES_ORDER: "sales.view", SALES_INVOICE: "sales.view", DELIVERY_NOTE: "sales.view", SALES_RETURN: "sales.view",
  PURCHASE_ORDER: "purchases.view", PURCHASE_INVOICE: "purchases.view", GOODS_RECEIPT: "purchases.view", PURCHASE_RETURN: "purchases.view",
  JOURNAL_ENTRY: "accounting.view",
};

/** Org-scoped notification counts + recent activity, filtered to what `perms` allows
 *  (undefined = show everything, e.g. the daily cron). `sinceIso` counts documents
 *  created after that instant. */
export async function computeNotifications(orgId: string, sinceIso?: string, perms?: Set<string>): Promise<Notifications> {
  const since = sinceIso ? new Date(sinceIso) : null;
  const can = (p: string) => !perms || perms.has(p);
  const anyDoc = can("sales.view") || can("purchases.view") || can("accounting.view");
  const ZERO = Promise.resolve({ rows: [{ n: 0 }] } as { rows: { n: number }[] });
  const ZERO_TOTAL = Promise.resolve({ rows: [{ n: 0, total: "0" }] } as { rows: { n: number; total: string }[] });

  const [low, exp, ar, ap, activity, since_, drafts, newOrdersRes, reviewRes, stockWaitRes] = await Promise.all([
    can("inventory.view") ? db.execute<{ n: number }>(sql`
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
      ) s`) : ZERO,
    can("inventory.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM stock_batches
      WHERE organization_id = ${orgId} AND remaining_quantity > 0
        AND expiry_date IS NOT NULL AND expiry_date <= now() + interval '30 days'`) : ZERO,
    can("sales.view") ? db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM sales_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`) : ZERO_TOTAL,
    can("purchases.view") ? db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM purchase_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`) : ZERO_TOTAL,
    anyDoc ? db.select({ action: auditLogs.action, summary: auditLogs.summary, number: auditLogs.entityNumber, entityType: auditLogs.entityType, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"])))
      .orderBy(desc(auditLogs.createdAt)).limit(16) : Promise.resolve([] as { action: string; summary: string | null; number: string | null; entityType: string; at: Date }[]),
    since && anyDoc
      ? db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
          .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"]), gt(auditLogs.createdAt, since)))
      : Promise.resolve([{ n: 0 }]),
    (can("sales.view") || can("purchases.view")) ? countPendingDrafts(orgId) : Promise.resolve(0),
    // New marketplace (Amazon/Noon/…) sales orders since the user last looked.
    since && can("sales.view")
      ? db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM sales_orders
          WHERE organization_id = ${orgId} AND channel IS NOT NULL AND created_at > ${since}`)
      : ZERO,
    // Items auto-created from marketplace orders with an unknown SKU — need a cost/review.
    can("inventory.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM items
      WHERE organization_id = ${orgId} AND needs_review = true AND is_active = true`) : ZERO,
    // DRAFT delivery notes parked by the auto-flow because stock was short — the
    // "بانتظار توفّر المخزون" marker (see STOCK_WAIT_MARK in lib/erp/fulfillment.ts).
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM delivery_notes
      WHERE organization_id = ${orgId} AND status = 'DRAFT' AND notes LIKE 'بانتظار توفّر المخزون%'`) : ZERO,
  ]);

  const lowStock = Number(low.rows[0]?.n ?? 0);
  const expiring = Number(exp.rows[0]?.n ?? 0);
  const overdueAR = Number(ar.rows[0]?.n ?? 0);
  const overdueTotal = Number(ar.rows[0]?.total ?? 0);
  const overdueAP = Number(ap.rows[0]?.n ?? 0);
  const overdueAPTotal = Number(ap.rows[0]?.total ?? 0);
  const newActivity = Number(since_[0]?.n ?? 0);
  const newOrders = Number(newOrdersRes.rows[0]?.n ?? 0);
  const needsReview = Number(reviewRes.rows[0]?.n ?? 0);
  const stockWaiting = Number(stockWaitRes.rows[0]?.n ?? 0);
  const recent: Activity[] = activity
    .filter((a) => { const p = ENTITY_PERM[a.entityType]; return !p || can(p); }) // only docs this member can see
    .slice(0, 8)
    .map((a) => {
      const base = ENTITY_PATH[a.entityType];
      return { action: a.action, summary: a.summary, number: a.number, at: a.at.toISOString(), href: base && a.number ? `${base}/${encodeURIComponent(a.number)}` : null };
    });
  return { lowStock, expiring, overdueAR, overdueTotal, overdueAP, overdueAPTotal, pendingDrafts: drafts, stockWaiting, newActivity, newOrders, needsReview, total: lowStock + expiring + overdueAR + overdueAP + drafts + stockWaiting + newActivity + newOrders + needsReview, recent };
}
