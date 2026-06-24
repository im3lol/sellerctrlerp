import Link from "next/link";
import { requireErpModule } from "@/lib/erp/org";
import { getErpOverview } from "@/lib/erp/overview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const SHORTCUTS = [
  { label: "المحاسبة", href: "/erp/accounting", icon: "Calculator" },
  { label: "المخزون", href: "/erp/inventory", icon: "Warehouse" },
  { label: "فواتير البيع", href: "/erp/sales/invoices", icon: "ReceiptText" },
  { label: "فواتير الشراء", href: "/erp/purchases/invoices", icon: "ShoppingCart" },
  { label: "تقرير دفتر المبيعات", href: "/erp/sales/reports/ledger", icon: "ScrollText" },
  { label: "تقرير دفتر المشتريات", href: "/erp/purchases/reports/ledger", icon: "ScrollText" },
  { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes" },
  { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie" },
  { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp" },
  { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale" },
  { label: "أعمار الديون (عملاء)", href: "/erp/sales/aging", icon: "Users" },
  { label: "أعمار الديون (موردون)", href: "/erp/purchases/aging", icon: "Truck" },
] as const;

export default async function ErpDashboardPage() {
  const { orgId } = await requireErpModule("reports.view");
  const o = await getErpOverview(orgId);

  const maxVal = Math.max(...o.topItems.map((r) => r.value), 1);

  const kpis = [
    { label: "صافي الربح/الخسارة", value: money(o.net), tone: o.net >= 0 ? "text-emerald-600" : "text-destructive", icon: "TrendingUp" },
    { label: "النقدية والبنوك", value: money(o.cash), tone: "text-foreground", icon: "Wallet" },
    { label: "الذمم المدينة (عملاء)", value: money(o.ar), tone: "text-foreground", icon: "Users" },
    { label: "الذمم الدائنة (موردون)", value: money(o.ap), tone: "text-foreground", icon: "Truck" },
    { label: "قيمة المخزون", value: money(o.inventoryValue), tone: "text-emerald-600", icon: "Boxes" },
  ];

  const max = Math.max(o.income, o.expense, Math.abs(o.net), 1);
  const bars = [
    { label: "الإيرادات", value: o.income, color: "bg-rose-400" },
    { label: "المصروفات", value: o.expense, color: "bg-blue-500" },
    { label: "صافي الربح", value: o.net, color: o.net >= 0 ? "bg-emerald-500" : "bg-destructive" },
  ];

  const alerts = [
    { label: "تحت حد الطلب", value: o.lowStock, href: "/erp/inventory/reorder", icon: "TriangleAlert", tone: o.lowStock ? "text-amber-600" : "text-muted-foreground" },
    { label: "أصناف منتهية المخزون", value: o.outOfStock, href: "/erp/inventory/reorder", icon: "PackageX", tone: o.outOfStock ? "text-destructive" : "text-muted-foreground" },
    { label: "دفعات قاربت الانتهاء", value: o.nearExpiryCount, href: "/erp/inventory/expiry", icon: "Clock", tone: o.nearExpiryCount ? "text-amber-600" : "text-muted-foreground" },
    { label: "دفعات منتهية الصلاحية", value: o.expiredCount, href: "/erp/inventory/expiry", icon: "CalendarX", tone: o.expiredCount ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="LayoutDashboard" title="لوحة ERP" subtitle="نظرة شاملة على المالية والمخزون والمبيعات والمشتريات" />

      {/* KPI cards */}
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profit & Loss chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>الأرباح والخسائر</CardTitle>
            <CardDescription>الإيرادات مقابل المصروفات وصافي الربح (من القيود المُرحّلة).</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-56 items-end justify-around gap-6 border-b pb-2">
              {bars.map((b) => (
                <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-sm font-semibold tabular-nums">{money(b.value)}</span>
                  <div className={cn("w-full max-w-28 rounded-t-md", b.color)} style={{ height: `${Math.max((Math.abs(b.value) / max) * 100, 2)}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-around text-sm text-muted-foreground">
              {bars.map((b) => <span key={b.label}>{b.label}</span>)}
            </div>
          </CardContent>
        </Card>

        {/* This-month sales vs purchases */}
        <Card>
          <CardHeader>
            <CardTitle>حركة الشهر</CardTitle>
            <CardDescription>الفواتير المُرحّلة هذا الشهر.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 py-2">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Icon name="ReceiptText" className="size-4 text-emerald-600" /> مبيعات الشهر</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{intf(o.salesCount)} فاتورة</span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{money(o.salesMonth)}</div>
            </div>
            <div className="border-t pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted-foreground"><Icon name="ShoppingCart" className="size-4 text-blue-600" /> مشتريات الشهر</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{intf(o.purchasesCount)} فاتورة</span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-blue-600">{money(o.purchasesMonth)}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top items */}
        <Card>
          <CardHeader>
            <CardTitle>أعلى الأصناف قيمةً</CardTitle>
            <CardDescription>أكبر 6 أصناف من حيث قيمة المخزون ({intf(o.totalItems)} صنف نشِط).</CardDescription>
          </CardHeader>
          <CardContent>
            {o.topItems.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">لا توجد أرصدة بعد.</div>
            ) : (
              <div className="space-y-3">
                {o.topItems.map((r) => (
                  <div key={r.name} className="space-y-1">
                    <div className="flex justify-between text-sm"><span className="truncate">{r.name}</span><span className="font-medium tabular-nums">{money(r.value)}</span></div>
                    <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((r.value / maxVal) * 100, 2)}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card>
          <CardHeader><CardTitle>التنبيهات</CardTitle><CardDescription>نواقص المخزون وصلاحية الدفعات.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {alerts.map((a) => (
                <Link key={a.label} href={a.href} className="group flex flex-col gap-1 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={a.icon} className={cn("size-4", a.tone)} /> {a.label}</div>
                  <div className={cn("text-2xl font-bold tabular-nums", a.tone)}>{intf(a.value)}</div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Shortcuts */}
      <Card>
        <CardHeader><CardTitle>اختصارات</CardTitle><CardDescription>الوصول السريع لشاشات النظام.</CardDescription></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {SHORTCUTS.map((s) => (
              <Link key={s.href} href={s.href} className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"><Icon name={s.icon} className="size-4" /></div>
                <span className="flex-1 text-sm font-medium">{s.label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
