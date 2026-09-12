import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FilterBar, filterFieldCls } from "@/components/erp/filter-bar";
import { Label } from "@/components/ui/label";
import { type ReorderStatus } from "@/lib/erp/reorder";
import { getReorderPlan } from "@/lib/erp/reorder-data";

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const d1 = (n: number) => (n === Infinity ? "∞" : n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 }));

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
 *
 * Each supplier the shortfall was last bought from gets its own button, opening a purchase
 * order prefilled with exactly these quantities — reviewed before anything is saved.
 */
export default async function ReorderPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("inventory.view", async ({ orgId, can }) => {
    const sp = await searchParams;
    const windowDays = pick(sp.window, WINDOWS, 30);
    const leadDays = pick(sp.lead, LEADS, 14);
    const coverDays = pick(sp.cover, COVERS, 60);

    const planned = await getReorderPlan(orgId, { windowDays, leadDays, coverDays });
    const criticalCount = planned.filter((r) => r.status === "out" || r.status === "critical").length;

    // One prefilled order per last supplier; items never bought before share one more.
    const bySupplier = new Map<string, { name: string; count: number }>();
    for (const r of planned) {
      if (r.suggestedQty <= 0) continue;
      const key = r.supplierId ?? "none";
      const g = bySupplier.get(key) ?? { name: r.supplierName ?? "بدون مورد سابق", count: 0 };
      g.count++;
      bySupplier.set(key, g);
    }
    const qs = `window=${windowDays}&lead=${leadDays}&cover=${coverDays}`;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="TriangleAlert"
          title="تخطيط إعادة الطلب"
          subtitle={`${planned.length} صنف يحتاج طلب · ${criticalCount} حرج/نافد`}
          backHref="/inventory"
          action={bySupplier.size > 0 && can("purchases.create") ? (
            <div className="flex flex-wrap gap-2">
              {[...bySupplier].map(([key, g], idx) => (
                <Button key={key} asChild variant={idx === 0 ? "default" : "outline"}>
                  <Link href={`/purchases/orders/new?reorder=1&${qs}&supplier=${encodeURIComponent(key)}`}>
                    <Icon name="ClipboardList" className="size-4" />أمر شراء — {g.name} ({q(g.count)})
                  </Link>
                </Button>
              ))}
            </div>
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
            <CardDescription>
              «أيام التغطية» = المتاح ÷ معدّل البيع اليومي. أي صنف تغطيته أقل من زمن التوريد ({leadDays} يوم) هيخلص قبل وصول الشحنة.
              الأصناف اللي ماتباعتش في الفترة ومالهاش حد طلب مش بتظهر هنا.
            </CardDescription>
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
                      <TableHead className="text-start">آخر مورد</TableHead>
                      <TableHead className="text-start">المتاح</TableHead>
                      <TableHead className="text-start">الوارد</TableHead>
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
                        <TableRow key={r.itemId}>
                          <TableCell className="font-mono whitespace-nowrap">{r.code}</TableCell>
                          <TableCell className="max-w-[300px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={r.name ?? undefined}>{r.name}</div></TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{r.supplierName ?? "—"}</TableCell>
                          <TableCell>{q(r.onHand)}</TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{r.inbound > 0 ? q(r.inbound) : "—"}</TableCell>
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
