"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActiveOrg } from "@/lib/erp/org";

export type Notifications = {
  lowStock: number;      // active items at/below reorder level
  expiring: number;      // batches expired or expiring within 30 days
  overdueAR: number;     // past-due sales invoices with a balance
  overdueTotal: number;  // their total outstanding
  total: number;
};

// ponytail: counts + links to the existing alert pages — no notifications table,
// no read/unread state. Add persistence when users need to dismiss individual ones.
export async function getNotificationsAction(): Promise<Notifications> {
  const empty: Notifications = { lowStock: 0, expiring: 0, overdueAR: 0, overdueTotal: 0, total: 0 };
  const { org } = await getActiveOrg();
  if (!org) return empty;
  const orgId = org.id;

  const [low, exp, ar] = await Promise.all([
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
  ]);

  const lowStock = Number(low.rows[0]?.n ?? 0);
  const expiring = Number(exp.rows[0]?.n ?? 0);
  const overdueAR = Number(ar.rows[0]?.n ?? 0);
  const overdueTotal = Number(ar.rows[0]?.total ?? 0);
  return { lowStock, expiring, overdueAR, overdueTotal, total: lowStock + expiring + overdueAR };
}
