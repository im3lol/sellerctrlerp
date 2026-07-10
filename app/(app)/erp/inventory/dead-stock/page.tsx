import { sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

type SP = { days?: string; q?: string };
const DAYS = [30, 60, 90, 180, 365];

type Row = { code: string | null; name: string | null; qty: number; val: number; sold: number; last: string | null };

export default async function DeadStockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("inventory.view");
  const sp = await searchParams;
  const days = DAYS.includes(Number(sp.days)) ? Number(sp.days) : 90;
  const q = (sp.q ?? "").trim().toLowerCase();
  const since = new Date(Date.now() - days * 86_400_000);

  // On-hand qty+value per item (latest per item+warehouse) LEFT JOINed with sales
  // velocity over the window (gross units issued as sales + last sale date).
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

  const classify = (r: Row) => {
    const qty = Number(r.qty), sold = Number(r.sold);
    if (sold <= 0) return { status: "راكد", tone: "destructive" as const, cover: Infinity };
    const cover = qty / (sold / days); // days of cover at current velocity
    if (cover >= days) return { status: "بطيء", tone: "secondary" as const, cover };
    return { status: "متحرك", tone: "outline" as const, cover };
  };

  let list = rows.map((r) => ({ ...r, qty: Number(r.qty), val: Number(r.val), sold: Number(r.sold), ...classify(r) }));
  if (q) list = list.filter((r) => r.code?.toLowerCase().includes(q) || r.name?.toLowerCase().includes(q));
  const rank = { "راكد": 0, "بطيء": 1, "متحرك": 2 } as Record<string, number>;
  list.sort((a, b) => (rank[a.status] - rank[b.status]) || b.val - a.val);

  const deadVal = list.filter((r) => r.status === "راكد").reduce((s, r) => s + r.val, 0);
  const slowVal = list.filter((r) => r.status === "بطيء").reduce((s, r) => s + r.val, 0);
  const deadCount = list.filter((r) => r.status === "راكد").length;

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="PackageX" title="المخزون الراكد وبطيء الحركة" subtitle="رأس المال المحبوس في بضاعة لا تتحرك" />

      <FilterBar active={!!q || days !== 90} clearHref="/erp/inventory/dead-stock">
        <div className="space-y-2">
          <Label htmlFor="days">فترة القياس</Label>
          <select id="days" name="days" defaultValue={String(days)} className={`${filterFieldCls} min-w-32`}>
            {DAYS.map((d) => <option key={d} value={d}>آخر {d} يوم</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="q">بحث</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="الكود أو الاسم" className="min-w-56" />
        </div>
      </FilterBar>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">أصناف راكدة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{deadCount}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">قيمة المخزون الراكد</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-destructive">{fmt(deadVal)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">قيمة المخزون البطيء</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-amber-600">{fmt(slowVal)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>الأصناف المتوفّرة مرتّبة حسب الركود</CardTitle>
          <CardDescription>«راكد» = لا مبيعات خلال الفترة · «بطيء» = المخزون يكفي أكثر من فترة كاملة بمعدّل البيع الحالي.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا يوجد مخزون متوفّر مطابق.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-end">المتوفّر</TableHead>
                  <TableHead className="text-end">قيمة المخزون</TableHead>
                  <TableHead className="text-end">مباع (الفترة)</TableHead>
                  <TableHead className="text-end">آخر بيع</TableHead>
                  <TableHead className="text-end">تغطية (يوم)</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r, i) => (
                  <TableRow key={r.code ?? i}>
                    <TableCell><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</TableCell>
                    <TableCell className="text-end tabular-nums">{qtyf(r.qty)}</TableCell>
                    <TableCell className="text-end tabular-nums font-medium">{fmt(r.val)}</TableCell>
                    <TableCell className="text-end tabular-nums">{qtyf(r.sold)}</TableCell>
                    <TableCell className="text-end tabular-nums text-muted-foreground">{dt(r.last)}</TableCell>
                    <TableCell className="text-end tabular-nums">{Number.isFinite(r.cover) ? Math.round(r.cover) : "∞"}</TableCell>
                    <TableCell><Badge variant={r.tone}>{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
