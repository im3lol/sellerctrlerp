import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resolveOrgByApiKey, apiKeyFromRequest } from "@/lib/erp/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/stock — on-hand quantity + value per item (latest ledger balance).
 *  Auth: Bearer <api key> or x-api-key. */
export async function GET(req: Request) {
  const orgId = await resolveOrgByApiKey(apiKeyFromRequest(req));
  if (!orgId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const res = await db.execute<{ code: string; name: string; qty: string; value: string }>(sql`
    SELECT i.code, COALESCE(i.name_ar, i.code) AS name,
           COALESCE(s.qty, 0) AS qty, COALESCE(s.val, 0) AS value
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(bq) AS qty, SUM(bv) AS val FROM (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq, balance_value bv
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, number DESC
      ) t GROUP BY item_id
    ) s ON s.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
    ORDER BY i.code
  `);

  return Response.json({ data: (res.rows as { code: string; name: string; qty: string; value: string }[]).map((r) => ({ code: r.code, name: r.name, onHand: Number(r.qty), value: Number(r.value) })) });
}
