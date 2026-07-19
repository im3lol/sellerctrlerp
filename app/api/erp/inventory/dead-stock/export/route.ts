import { sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const DAYS = [30, 60, 90, 180, 365];

type Row = { code: string; name: string; qty: string; val: string; sold: string; last: string | null };

/** Excel export of dead/slow-moving stock over the window (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const p = new URL(req.url).searchParams;
  const days = DAYS.includes(Number(p.get("days"))) ? Number(p.get("days")) : 90;
  const since = new Date(Date.now() - days * 86_400_000);

  return withOrgScope(orgId, false, async () => {
  const rows = (await db.execute<Row>(sql`
    SELECT i.code, i.name_ar AS name,
           COALESCE(s.qty, 0) AS qty, COALESCE(s.val, 0) AS val,
           COALESCE(v.sold, 0) AS sold, v.last
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(bq) AS qty, SUM(bv) AS val FROM (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq, balance_value bv
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, number DESC
      ) t GROUP BY item_id
    ) s ON s.item_id = i.id
    LEFT JOIN (
      SELECT item_id, SUM(quantity) AS sold, MAX(date) AS last
      FROM stock_movements
      WHERE organization_id = ${orgId} AND type = 'OUT' AND reference_type IN ('DELIVERY','SALES_INVOICE') AND date >= ${since}
      GROUP BY item_id
    ) v ON v.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true AND COALESCE(s.qty,0) > 0
  `)).rows as Row[];

  const classify = (qty: number, sold: number) => {
    if (sold <= 0) return "راكد";
    const cover = qty / (sold / days);
    return cover >= days ? "بطيء" : "متحرك";
  };
  const rank: Record<string, number> = { "راكد": 0, "بطيء": 1, "متحرك": 2 };
  const list = rows.map((r) => {
    const qty = Number(r.qty), sold = Number(r.sold), val = Number(r.val);
    return { code: r.code, name: r.name, qty, val, sold, last: r.last, status: classify(qty, sold) };
  }).sort((a, b) => rank[a.status] - rank[b.status] || b.val - a.val);

  const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

  return xlsxResponse({
    sheet: "المخزون الراكد",
    filename: `dead-stock-${days}d`,
    headers: ["الكود", "الصنف", "الحالة", "الكمية", "القيمة", `المُباع (${days} يوم)`, "آخر بيع"],
    rows: list.map((r) => [r.code, r.name, r.status, r.qty, r.val, r.sold, iso(r.last)]),
    colWidths: [12, 28, 10, 12, 16, 14, 14],
  });
  });
}
