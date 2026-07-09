"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";

export type Activity = { action: string; summary: string | null; number: string | null; at: string; href: string | null };
export type Notifications = {
  lowStock: number;      // active items at/below reorder level
  expiring: number;      // batches expired or expiring within 30 days
  overdueAR: number;     // past-due sales invoices with a balance
  overdueTotal: number;  // their total outstanding
  total: number;         // alert badge (actionable alerts only, not activity)
  recent: Activity[];    // last documents created/confirmed
};

// Entity type → detail route base (documents route by their readable number).
const ENTITY_PATH: Record<string, string> = {
  SALES_ORDER: "/erp/sales/orders", SALES_INVOICE: "/erp/sales/invoices", DELIVERY_NOTE: "/erp/sales/deliveries",
  SALES_RETURN: "/erp/sales/returns", PURCHASE_ORDER: "/erp/purchases/orders", PURCHASE_INVOICE: "/erp/purchases/invoices",
  GOODS_RECEIPT: "/erp/purchases/receipts", PURCHASE_RETURN: "/erp/purchases/returns", JOURNAL_ENTRY: "/erp/accounting/journal",
};

// ponytail: counts + links to the existing alert pages — no notifications table,
// no read/unread state. Add persistence when users need to dismiss individual ones.
export async function getNotificationsAction(): Promise<Notifications> {
  const empty: Notifications = { lowStock: 0, expiring: 0, overdueAR: 0, overdueTotal: 0, total: 0, recent: [] };
  const { org } = await getActiveOrg();
  if (!org) return empty;
  const orgId = org.id;

  const [low, exp, ar, activity] = await Promise.all([
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (
        SELECT i.id
        FROM items i
        LEFT JOIN (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, id DESC
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
        AND status NOT IN ('DRAFT','CANCELLED')
        AND due_date IS NOT NULL AND due_date < now()`),
    db.select({ action: auditLogs.action, summary: auditLogs.summary, number: auditLogs.entityNumber, entityType: auditLogs.entityType, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"])))
      .orderBy(desc(auditLogs.createdAt)).limit(8),
  ]);

  const lowStock = Number(low.rows[0]?.n ?? 0);
  const expiring = Number(exp.rows[0]?.n ?? 0);
  const overdueAR = Number(ar.rows[0]?.n ?? 0);
  const overdueTotal = Number(ar.rows[0]?.total ?? 0);
  const recent: Activity[] = activity.map((a) => {
    const base = ENTITY_PATH[a.entityType];
    return { action: a.action, summary: a.summary, number: a.number, at: a.at.toISOString(), href: base && a.number ? `${base}/${encodeURIComponent(a.number)}` : null };
  });
  return { lowStock, expiring, overdueAR, overdueTotal, total: lowStock + expiring + overdueAR, recent };
}
