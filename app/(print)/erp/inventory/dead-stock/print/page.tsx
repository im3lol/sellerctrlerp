import { sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, qty } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const CAP = 3000;
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const sdt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";

type SP = { days?: string; q?: string };
const DAYS = [30, 60, 90, 180, 365];
type Row = { code: string | null; name: string | null; qty: number; val: number; sold: number; last: string | null };

export default async function PrintDeadStockPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    const sp = await searchParams;
    const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 90;
    const q = (sp.q ?? "").trim().toLowerCase();
    const since = new Date(Date.now() - days * 86_400_000);

    const [{ org }, result] = await Promise.all([
      loadPrintHeader(orgId),
      db.execute<Row>(sql`
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
      `),
    ]);
    const rows = result.rows as Row[];

    const classify = (r: Row) => {
      const qn = Number(r.qty), sold = Number(r.sold);
      if (sold <= 0) return { status: "راكد", cover: Infinity };
      const cover = qn / (sold / days);
      if (cover >= days) return { status: "بطيء", cover };
      return { status: "متحرك", cover };
    };

    let list = rows.map((r) => ({ ...r, qty: Number(r.qty), val: Number(r.val), sold: Number(r.sold), ...classify(r) }));
    if (q) list = list.filter((r) => r.code?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q));
    const rank = { "راكد": 0, "بطيء": 1, "متحرك": 2 } as Record<string, number>;
    list.sort((a, b) => (rank[a.status] - rank[b.status]) || b.val - a.val);

    const deadVal = list.filter((r) => r.status === "راكد").reduce((s, r) => s + r.val, 0);
    const slowVal = list.filter((r) => r.status === "بطيء").reduce((s, r) => s + r.val, 0);
    const deadCount = list.filter((r) => r.status === "راكد").length;
    const shown = list.slice(0, CAP);

    const backQs = new URLSearchParams();
    if (sp.days) backQs.set("days", sp.days);
    if (q) backQs.set("q", q);

    return (
      <ReportSheet
        org={org}
        title="المخزون الراكد وبطيء الحركة"
        backHref={`/inventory/dead-stock${backQs.size ? `?${backQs}` : ""}`}
        filters={[
          { label: "فترة القياس", value: `آخر ${intl(days)} يوم` },
          ...(q ? [{ label: "بحث", value: q }] : []),
        ]}
        kpis={[
          { label: "أصناف راكدة", value: intl(deadCount) },
          { label: "قيمة المخزون الراكد", value: fmt(deadVal), tone: "danger" },
          { label: "قيمة المخزون البطيء", value: fmt(slowVal) },
        ]}
        sections={[{
          columns: [
            { label: "الصنف", width: "32%" },
            { label: "المتوفّر", align: "end", width: "10%" },
            { label: "قيمة المخزون", align: "end", width: "13%" },
            { label: "مباع (الفترة)", align: "end", width: "11%" },
            { label: "آخر بيع", align: "end", width: "12%" },
            { label: "تغطية (يوم)", align: "end", width: "11%" },
            { label: "الحالة", width: "11%" },
          ],
          rows: shown.map((r) => [
            <span key="n">
              <span dir="ltr" style={{ display: "block", textAlign: "start" }}>{r.name}</span>
              <span dir="ltr" style={{ color: "#8a93a6", fontSize: 9.5 }}>{r.code}</span>
            </span>,
            qty(r.qty),
            fmt(r.val),
            qty(r.sold),
            sdt(r.last),
            Number.isFinite(r.cover) ? intl(Math.round(r.cover)) : "∞",
            r.status,
          ]),
        }]}
        note={list.length > CAP ? `عُرضت أول ${intl(CAP)} صف من ${intl(list.length)}.` : null}
      />
    );
  });
}
