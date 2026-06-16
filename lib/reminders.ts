import { pool } from "@/lib/db";
import { notify } from "@/lib/activity";

/**
 * Nudge employees about assigned products that haven't moved. A product is
 * "stale" when it's assigned, published (not draft), not in a terminal status,
 * and hasn't been updated for `days` days. One aggregated notification per
 * employee. Returns how many employees were notified.
 */
export async function remindStaleProducts(days = 3): Promise<number> {
  const { rows } = await pool.query(
    `SELECT p.assigned_to AS uid, count(*)::int AS c
       FROM products p
       LEFT JOIN product_statuses s ON s.id = p.status_id
      WHERE p.assigned_to IS NOT NULL
        AND p.is_draft = false
        AND COALESCE(s.is_terminal, false) = false
        AND p.updated_at < now() - (($1)::text || ' days')::interval
      GROUP BY p.assigned_to`,
    [String(days)],
  );

  for (const r of rows as { uid: string; c: number }[]) {
    await notify({
      userId: r.uid,
      type: "products_stale",
      title: "منتجات بحاجة لمتابعة",
      body: `لديك ${r.c} منتج دون حركة منذ أكثر من ${days} أيام — راجِعها وحدّث حالتها.`,
      link: "/products",
    });
  }
  return rows.length;
}
