import { sql } from "drizzle-orm";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { getExpiryReport } from "@/lib/erp/expiry";
import type { DocRow } from "@/lib/erp/mobile-lists";

/**
 * The /api/v1 routes call these directly after authorizeApi with NO surrounding wrapper,
 * so every export is wrapped in the tenant DB scope here — same pattern as
 * lib/erp/mobile-lists.ts. Without it they run on the bare pool and, once RLS is enforced,
 * silently return zero rows. withOrgScope reuses an already-open scope, so a caller that
 * is already scoped (a page via loadErpPage) pays nothing.
 */
const scoped = <A extends unknown[], R>(fn: (orgId: string, ...args: A) => Promise<R>) =>
  (orgId: string, ...args: A): Promise<R> => withOrgScope(orgId, false, () => fn(orgId, ...args));


type ReorderRow = { code: string; name: string; min_stock: string; on_hand: string };

/** Items whose on-hand is at/below their reorder level (تنبيهات إعادة الطلب). */
async function reorderAlertsImpl(orgId: string): Promise<DocRow[]> {
  const res = await db.execute<ReorderRow>(sql`
    WITH latest AS (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
      FROM stock_movements WHERE organization_id = ${orgId}
      ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
    )
    SELECT i.code, coalesce(i.name_ar, i.code) AS name,
           coalesce(i.min_stock, 0) AS min_stock,
           coalesce(sum(l.balance_quantity), 0) AS on_hand
    FROM items i LEFT JOIN latest l ON l.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
    GROUP BY i.id
    HAVING coalesce(sum(l.balance_quantity), 0) <= coalesce(i.min_stock, 0)
    ORDER BY on_hand ASC, i.code ASC LIMIT 100`);
  return (res.rows as ReorderRow[]).map((r) => ({
    id: r.code, number: r.code, title: r.name,
    subtitle: `حد الطلب: ${Number(r.min_stock)}`, amount: Number(r.on_hand), status: "نقص",
  }));
}

type DeadRow = { code: string; name: string; qty: string; last: string | null };

/** Items with stock but no sale in the last `days` (المخزون الراكد). */
async function deadStockAlertsImpl(orgId: string, days = 90): Promise<DocRow[]> {
  const since = new Date(Date.now() - days * 86400000);
  const res = await db.execute<DeadRow>(sql`
    SELECT i.code, coalesce(i.name_ar, i.code) AS name, coalesce(s.qty, 0) AS qty, v.last
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(bq) AS qty FROM (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
      ) t GROUP BY item_id
    ) s ON s.item_id = i.id
    LEFT JOIN (
      SELECT item_id, MAX(date) AS last FROM stock_movements
      WHERE organization_id = ${orgId} AND type = 'OUT'
        AND reference_type IN ('DELIVERY','SALES_INVOICE') AND date >= ${since}
      GROUP BY item_id
    ) v ON v.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
      AND coalesce(s.qty,0) > 0 AND v.last IS NULL
    ORDER BY s.qty DESC LIMIT 100`);
  return (res.rows as DeadRow[]).map((r) => ({
    id: r.code, number: r.code, title: r.name,
    subtitle: `بدون بيع منذ ${days} يوم`, amount: Number(r.qty), status: "راكد",
  }));
}

/** Batches expired or near expiry within `withinDays` (تنبيهات انتهاء الصلاحية). */
async function expiryAlertsImpl(orgId: string, withinDays = 30): Promise<DocRow[]> {
  const rep = await getExpiryReport(orgId, { withinDays });
  return rep.rows
    .filter((r) => r.status !== "OK")
    .slice(0, 100)
    .map((r) => ({
      id: r.id, number: r.itemCode, title: r.itemName,
      subtitle: `${r.warehouse}${r.batchNo ? ` · ${r.batchNo}` : ""} · ${r.daysLeft < 0 ? `منتهٍ منذ ${-r.daysLeft} يوم` : `ينتهي خلال ${r.daysLeft} يوم`}`,
      amount: r.remaining, status: r.status === "EXPIRED" ? "منتهٍ" : "قريب",
    }));
}

export const reorderAlerts = scoped(reorderAlertsImpl);
export const deadStockAlerts = scoped(deadStockAlertsImpl);
export const expiryAlerts = scoped(expiryAlertsImpl);
