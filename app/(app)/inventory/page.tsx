import Link from "next/link";
import { sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AcademyLink } from "@/components/erp/academy-link";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { BarChart } from "@/components/charts/bar-chart";
import { StatusDonut } from "@/components/charts/status-donut";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const pct = (n: number) => `${(n * 100).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 1 })}%`;

const SHORTCUTS = [
  { label: "الأصناف", href: "/inventory/items", icon: "Package", key: "items" },
  { label: "صنف جديد", href: "/inventory/items/new", icon: "Plus" },
  { label: "أرصدة المخزون", href: "/inventory/stock", icon: "Boxes" },
  { label: "دفتر حركة المخزون", href: "/inventory/ledger", icon: "ScrollText" },
  { label: "تسويات المخزون", href: "/inventory/adjustments", icon: "ClipboardCheck" },
  { label: "التحويلات المخزنية", href: "/inventory/transfers", icon: "ArrowLeftRight" },
  { label: "تنبيهات إعادة الطلب", href: "/inventory/reorder", icon: "TriangleAlert" },
] as const;

type ItemRow = { id: string; code: string; name: string; min_stock: string; category: string };
type BalRow = { item_id: string; warehouse: string | null; qty: string; val: string };

export default async function InventoryDashboardPage() {
  return loadErpPage("inventory.view", async ({ orgId }) => {
    // Two scans only: (1) light — active items + their category; (2) the one heavy
    // DISTINCT ON over stock_movements for the latest balance per item+warehouse.
    // Every KPI/chart below is aggregated from these in JS — no extra heavy queries.
    const [itemRows, balRows, nearExpR] = await Promise.all([
      db.execute<ItemRow>(sql`
        SELECT i.id, i.code, COALESCE(i.name_ar, i.code) AS name, i.min_stock,
               COALESCE(c.name_ar, 'بدون تصنيف') AS category
        FROM items i
        LEFT JOIN item_categories c ON c.id = i.category_id
        WHERE i.organization_id = ${orgId} AND i.is_active = true`),
      db.execute<BalRow>(sql`
        SELECT b.item_id, w.name_ar AS warehouse, b.bq AS qty, b.bv AS val
        FROM (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, warehouse_id, balance_quantity bq, balance_value bv
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, number DESC
        ) b
        LEFT JOIN warehouses w ON w.id = b.warehouse_id`),
      db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM stock_batches
        WHERE organization_id = ${orgId} AND remaining_quantity > 0
          AND expiry_date IS NOT NULL AND expiry_date <= now() + interval '30 days'`),
    ]);

    const items = itemRows.rows as ItemRow[];
    const bals = balRows.rows as BalRow[];

    // Roll the per-warehouse balance rows up to per-item, and (separately) per-warehouse value.
    const byItem = new Map<string, { qty: number; val: number }>();
    const whValue = new Map<string, number>();
    for (const b of bals) {
      const q = Number(b.qty) || 0, v = Number(b.val) || 0;
      const cur = byItem.get(b.item_id) ?? { qty: 0, val: 0 };
      cur.qty += q; cur.val += v;
      byItem.set(b.item_id, cur);
      if (v) whValue.set(b.warehouse || "غير محدد", (whValue.get(b.warehouse || "غير محدد") ?? 0) + v);
    }

    const rows = items.map((i) => {
      const b = byItem.get(i.id) ?? { qty: 0, val: 0 };
      return { ...i, min: Number(i.min_stock) || 0, qty: b.qty, val: b.val };
    });

    const totalItems = rows.length;
    const totalValue = rows.reduce((s, r) => s + r.val, 0);
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const outOfStock = rows.filter((r) => r.qty <= 0).length;
    const lowStock = rows.filter((r) => r.min > 0 && r.qty > 0 && r.qty <= r.min).length;
    const healthy = totalItems - outOfStock - lowStock;
    const inStockItems = totalItems - outOfStock;
    const avgValue = inStockItems > 0 ? totalValue / inStockItems : 0;

    // ABC: rank items by inventory value; A = the items making up the first 80% of
    // total value, B = next 15%, C = last 5%. This is the useful form of "top items".
    const valued = rows.filter((r) => r.val > 0).sort((a, b) => b.val - a.val);
    const abc = { A: { n: 0, val: 0 }, B: { n: 0, val: 0 }, C: { n: 0, val: 0 } };
    let cum = 0;
    for (const r of valued) {
      cum += r.val;
      const share = totalValue > 0 ? cum / totalValue : 1;
      const cls = share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C";
      abc[cls].n++; abc[cls].val += r.val;
    }

    // Value by category (top 8) and by warehouse (top 8).
    const catValue = new Map<string, number>();
    for (const r of rows) if (r.val) catValue.set(r.category, (catValue.get(r.category) ?? 0) + r.val);
    const byCategory = [...catValue.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
    const byWarehouse = [...whValue.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);

    const nearExp = Number((nearExpR.rows as { n: number }[])[0]?.n ?? 0);
    const counts: Record<string, number> = { items: totalItems };

    const todos = [
      { label: "أصناف تحت حد الطلب", hint: "تحتاج إعادة طلب", count: lowStock, href: "/inventory/reorder", icon: "TriangleAlert" },
      { label: "أصناف نافدة", hint: "رصيد صفر", count: outOfStock, href: "/inventory/stock?status=OUT", icon: "PackageX" },
      { label: "قرب انتهاء الصلاحية", hint: "خلال 30 يوماً", count: nearExp, href: "/inventory/expiry", icon: "CalendarClock" },
    ];

    const kpis = [
      { label: "عدد الأصناف", value: intf(totalItems), icon: "Package", tone: "text-foreground" },
      { label: "قيمة المخزون", value: money(totalValue), icon: "Wallet", tone: "text-emerald-600" },
      { label: "إجمالي الكمية", value: intf(totalQty), icon: "Boxes", tone: "text-foreground" },
      { label: "متوسط قيمة الصنف", value: money(avgValue), icon: "Scale", tone: "text-foreground" },
      { label: "تحت الحد / نافد", value: `${intf(lowStock)} / ${intf(outOfStock)}`, icon: "TriangleAlert", tone: lowStock || outOfStock ? "text-amber-600" : "text-foreground" },
    ];

    const health = [
      { name: "سليم", value: healthy, color: "#10b981" },
      { name: "تحت الحد", value: lowStock, color: "#f59e0b" },
      { name: "نافد", value: outOfStock, color: "#ef4444" },
    ];

    const abcRows = [
      { cls: "A", label: "أصناف عالية القيمة (٨٠٪ من القيمة)", color: "bg-emerald-500", ...abc.A },
      { cls: "B", label: "أصناف متوسطة (١٥٪ التالية)", color: "bg-amber-500", ...abc.B },
      { cls: "C", label: "أصناف منخفضة (٥٪ الأخيرة)", color: "bg-slate-400", ...abc.C },
    ];

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Warehouse" title="المخزون" subtitle="نظرة عامة وتحليل المخزون"
          action={<AcademyLink module="inventory" />} />

        <NeedsAttention tiles={todos} />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm text-muted-foreground">{k.label}</div>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name={k.icon} className="size-4" /></div>
                </div>
                <div className={cn("mt-2 text-xl font-bold tabular-nums", k.tone)}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>حالة المخزون</CardTitle>
              <CardDescription>توزيع الأصناف حسب توفّر الرصيد.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusDonut data={health} unit="صنف" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>تحليل ABC</CardTitle>
              <CardDescription>تركّز قيمة المخزون — أين تُحتجز أموالك.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {totalValue === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">لا توجد قيمة مخزون بعد.</div>
              ) : (
                abcRows.map((a) => (
                  <div key={a.cls} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span className={cn("flex size-6 items-center justify-center rounded-md text-xs font-bold text-white", a.color)}>{a.cls}</span>
                        <span className="text-muted-foreground">{a.label}</span>
                      </span>
                      <span className="shrink-0 tabular-nums"><span className="font-semibold">{money(a.val)}</span> · {intf(a.n)} صنف</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted"><div className={cn("h-2 rounded-full", a.color)} style={{ width: `${Math.max((a.val / totalValue) * 100, 1)}%` }} /></div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>قيمة المخزون حسب التصنيف</CardTitle>
              <CardDescription>أعلى ٨ تصنيفات من حيث قيمة المخزون.</CardDescription>
            </CardHeader>
            <CardContent>
              {byCategory.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">لا توجد بيانات.</div>
              ) : (
                <BarChart data={byCategory} valueLabel="القيمة" money height={240} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>قيمة المخزون حسب المخزن</CardTitle>
              <CardDescription>توزيع القيمة على المخازن.</CardDescription>
            </CardHeader>
            <CardContent>
              {byWarehouse.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">لا توجد بيانات.</div>
              ) : (
                <BarChart data={byWarehouse} valueLabel="القيمة" money height={240} colors={["#6366f1"]} />
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>اختصارات</CardTitle><CardDescription>الوصول السريع لشاشات المخزون.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {SHORTCUTS.map((s) => (
                <Link key={s.href} href={s.href} className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon name={s.icon} className="size-4" /></div>
                  <span className="flex-1 text-sm font-medium">{s.label}</span>
                  {"key" in s && s.key && counts[s.key] != null && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{intf(counts[s.key])}</span>}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  });
}
