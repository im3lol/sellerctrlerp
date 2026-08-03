import Link from "next/link";
import { sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { Label } from "@/components/ui/label";
import { planReorder, type ReorderStatus } from "@/lib/erp/reorder";

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const d1 = (n: number) => (n === Infinity ? "∞" : n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 }));

type Row = { code: string; name: string; min_stock: string; on_hand: string; sold: string };

const WINDOWS = [30, 60, 90];
const LEADS = [7, 14, 21, 30, 45, 60];
const COVERS = [30, 45, 60, 90, 120];
const pick = (v: string | undefined, allowed: number[], def: number) => (allowed.includes(Number(v)) ? Number(v) : def);

const STATUS: Record<Exclude<ReorderStatus, "ok">, { label: string; tone: "destructive" | "secondary" | "outline" }> = {
  out: { label: "نافد", tone: "destructive" },
  critical: { label: "حرج", tone: "destructive" },
  low: { label: "منخفض", tone: "secondary" },
};

type SP = { window?: string; lead?: string; cover?: string };

/**
 * Demand-driven reorder planning: sales velocity → days of cover, flagged against the
 * supplier lead time. Items whose stock won't outlast the lead time are "حرج"; the
 * suggested quantity refills to the target days of cover. Falls back to the static
 * min_stock only for items with no sales history.
 */
export default async function ReorderPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const sp = await searchParams;
    const windowDays = pick(sp.window, WINDOWS, 30);
    const leadDays = pick(sp.lead, LEADS, 14);
    const coverDays = pick(sp.cover, COVERS, 60);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const res = await db.execute<Row>(sql`
      WITH latest AS (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, number DESC
      ), velocity AS (
        SELECT item_id, SUM(quantity) AS sold FROM stock_movements
        WHERE organization_id = ${orgId} AND type = 'OUT'
          AND reference_type IN ('DELIVERY','SALES_INVOICE') AND date >= ${since}
        GROUP BY item_id
      )
      SELECT i.code, coalesce(i.name_ar, i.code) AS name, coalesce(i.min_stock, 0) AS min_stock,
             coalesce(sum(l.balance_quantity), 0) AS on_hand, coalesce(max(v.sold), 0) AS sold
      FROM items i
      LEFT JOIN latest l ON l.item_id = i.id
      LEFT JOIN velocity v ON v.item_id = i.id
      WHERE i.organization_id = ${orgId} AND i.is_active = true
      GROUP BY i.id
    `);

    const planned = (res.rows as Row[])
      .map((r) => ({
        code: r.code, name: r.name,
        onHand: Number(r.on_hand),
        ...planReorder({
          onHand: Number(r.on_hand), soldInWindow: Number(r.sold), windowDays, leadDays, coverDays,
          minStock: Number(r.min_stock),
        }),
      }))
      .filter((r) => r.needsReorder);

    const rank: Record<ReorderStatus, number> = { out: 0, critical: 1, low: 2, ok: 3 };
    planned.sort((a, b) => rank[a.status] - rank[b.status] || a.daysOfCover - b.daysOfCover);

    const criticalCount = planned.filter((r) => r.status === "out" || r.status === "critical").length;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="TriangleAlert"
          title="تخطيط إعادة الطلب"
          subtitle={`${planned.length} صنف يحتاج طلب · ${criticalCount} حرج/نافد`}
          backHref="/inventory"
          action={planned.length > 0 && can("purchases.create") ? (
            <Button asChild><Link href="/purchases/orders/new?reorder=1"><Icon name="ClipboardList" className="size-4" />أنشئ أمر شراء بالنواقص</Link></Button>
          ) : undefined}
        />

        <FilterBar active={windowDays !== 30 || leadDays !== 14 || coverDays !== 60} clearHref="/inventory/reorder">
          <div className="space-y-2">
            <Label htmlFor="window">فترة قياس البيع</Label>
            <select id="window" name="window" defaultValue={String(windowDays)} className={`${filterFieldCls} min-w-32`}>
              {WINDOWS.map((w) => <option key={w} value={w}>آخر {w} يوم</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead">زمن التوريد (يوم)</Label>
            <select id="lead" name="lead" defaultValue={String(leadDays)} className={`${filterFieldCls} min-w-28`}>
              {LEADS.map((w) => <option key={w} value={w}>{w} يوم</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cover">تغطية مستهدفة (يوم)</Label>
            <select id="cover" name="cover" defaultValue={String(coverDays)} className={`${filterFieldCls} min-w-28`}>
              {COVERS.map((w) => <option key={w} value={w}>{w} يوم</option>)}
            </select>
          </div>
        </FilterBar>

        <Card>
          <CardHeader>
            <CardTitle>أصناف تحتاج طلبًا حسب معدّل البيع</CardTitle>
            <CardDescription>«أيام التغطية» = المتاح ÷ معدّل البيع اليومي. أي صنف تغطيته أقل من زمن التوريد ({leadDays} يوم) هيخلص قبل وصول الشحنة.</CardDescription>
          </CardHeader>
          <CardContent>
            {planned.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">كل الأصناف تغطيتها كافية ✓</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الكود</TableHead>
                      <TableHead className="text-start">الصنف</TableHead>
                      <TableHead className="text-start">المتاح</TableHead>
                      <TableHead className="text-start">بيع/يوم</TableHead>
                      <TableHead className="text-start">أيام التغطية</TableHead>
                      <TableHead className="text-start">حد الطلب</TableHead>
                      <TableHead className="text-start">المقترح طلبه</TableHead>
                      <TableHead className="text-start">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {planned.map((r) => {
                      const st = STATUS[r.status as Exclude<ReorderStatus, "ok">];
                      return (
                        <TableRow key={r.code}>
                          <TableCell className="font-mono whitespace-nowrap">{r.code}</TableCell>
                          <TableCell className="max-w-[300px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={r.name ?? undefined}>{r.name}</div></TableCell>
                          <TableCell>{q(r.onHand)}</TableCell>
                          <TableCell className="tabular-nums">{d1(r.velocity)}</TableCell>
                          <TableCell className="tabular-nums">{d1(r.daysOfCover)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{d1(r.reorderPoint)}</TableCell>
                          <TableCell className="font-semibold">{q(r.suggestedQty)}</TableCell>
                          <TableCell><Badge variant={st.tone}>{st.label}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
