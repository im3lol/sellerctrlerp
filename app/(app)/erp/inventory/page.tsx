import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const SHORTCUTS = [
  { label: "الأصناف", href: "/erp/inventory/items", icon: "Package", key: "items" },
  { label: "صنف جديد", href: "/erp/inventory/items/new", icon: "Plus" },
  { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes" },
  { label: "دفتر حركة المخزون", href: "/erp/inventory/ledger", icon: "ScrollText" },
  { label: "تسويات المخزون", href: "/erp/inventory/adjustments", icon: "ClipboardCheck" },
  { label: "التحويلات المخزنية", href: "/erp/inventory/transfers", icon: "ArrowLeftRight" },
  { label: "تنبيهات إعادة الطلب", href: "/erp/inventory/reorder", icon: "TriangleAlert" },
] as const;

export default async function InventoryDashboardPage() {
  const { orgId } = await requireErpModule("inventory.view");

  // On-hand qty + value per item (latest balance per warehouse), joined to min stock.
  const rows = (await db.execute<{ id: string; name: string; min_stock: string; qty: string; val: string }>(sql`
    SELECT i.id, COALESCE(i.name_ar, i.code) AS name, i.min_stock,
           COALESCE(s.qty, 0) AS qty, COALESCE(s.val, 0) AS val
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(bq) AS qty, SUM(bv) AS val FROM (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq, balance_value bv
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, id DESC
      ) t GROUP BY item_id
    ) s ON s.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
  `)).rows as { id: string; name: string; min_stock: string; qty: string; val: string }[];

  const totalItems = rows.length;
  const totalValue = rows.reduce((s, r) => s + Number(r.val), 0);
  const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
  const lowStock = rows.filter((r) => Number(r.min_stock) > 0 && Number(r.qty) <= Number(r.min_stock)).length;
  const outOfStock = rows.filter((r) => Number(r.qty) <= 0).length;
  const counts: Record<string, number> = { items: totalItems };

  const topItems = [...rows].sort((a, b) => Number(b.val) - Number(a.val)).slice(0, 6);
  const maxVal = Math.max(...topItems.map((r) => Number(r.val)), 1);

  const kpis = [
    { label: "عدد الأصناف", value: intf(totalItems), icon: "Package", tone: "text-foreground" },
    { label: "قيمة المخزون", value: money(totalValue), icon: "Wallet", tone: "text-emerald-600" },
    { label: "إجمالي الكمية", value: intf(totalQty), icon: "Boxes", tone: "text-foreground" },
    { label: "تحت حد الطلب", value: intf(lowStock), icon: "TriangleAlert", tone: lowStock ? "text-amber-600" : "text-foreground" },
    { label: "أصناف منتهية", value: intf(outOfStock), icon: "PackageX", tone: outOfStock ? "text-destructive" : "text-foreground" },
  ];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Warehouse" title="المخزون" subtitle="نظرة عامة وتحليل المخزون" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="flex items-center justify-between py-5">
              <div>
                <div className="text-sm text-muted-foreground">{k.label}</div>
                <div className={cn("mt-1 text-2xl font-bold tabular-nums", k.tone)}>{k.value}</div>
              </div>
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon name={k.icon} className="size-5" /></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>أعلى الأصناف قيمةً</CardTitle>
            <CardDescription>أكبر 6 أصناف من حيث قيمة المخزون.</CardDescription>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">لا توجد أرصدة بعد.</div>
            ) : (
              <div className="space-y-3">
                {topItems.map((r) => (
                  <div key={r.id} className="space-y-1">
                    <div className="flex justify-between text-sm"><span className="truncate">{r.name}</span><span className="font-medium tabular-nums">{money(Number(r.val))}</span></div>
                    <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((Number(r.val) / maxVal) * 100, 2)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>اختصارات</CardTitle><CardDescription>الوصول السريع لشاشات المخزون.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
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
    </div>
  );
}
