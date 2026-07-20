import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { getErpOverview } from "@/lib/erp/overview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";

const money = (n: number) => (n + 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export default async function AnalyticsPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    let ov: Awaited<ReturnType<typeof getErpOverview>> | null = null;
    try { ov = await getErpOverview(orgId); } catch { ov = null; }

    const kpis = ov
      ? [
          { label: "صافي الربح (حتى تاريخه)", value: money(ov.net), href: "/reports/income-statement", icon: "TrendingUp", tone: ov.net >= 0 ? "text-emerald-600" : "text-destructive" },
          { label: "النقدية والبنك", value: money(ov.cash), href: "/reports/cash-flow", icon: "Wallet", tone: "" },
          { label: "ذمم مدينة (عملاء)", value: money(ov.ar), href: "/sales/aging", icon: "ArrowDownLeft", tone: "" },
          { label: "ذمم دائنة (موردون)", value: money(ov.ap), href: "/purchases/aging", icon: "ArrowUpRight", tone: "" },
          { label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/inventory/stock", icon: "Boxes", tone: "" },
          { label: "مبيعات هذا الشهر", value: money(ov.salesMonth), href: "/sales/reports/ledger", icon: "ShoppingCart", tone: "" },
        ]
      : [];

    const pnl = ov?.pnlTrend.map((m) => ({ label: m.label, revenue: m.revenue, expense: m.expense })) ?? [];
    const hasPnl = pnl.some((m) => m.revenue > 0 || m.expense > 0);
    const topItems = ov?.topItems ?? [];
    const maxItem = Math.max(...topItems.map((t) => t.value), 1);

    const alerts = ov
      ? ([
          ov.overdueAR > 0 && { label: `ذمم متأخرة: ${money(ov.overdueAR)}`, href: "/sales/aging", danger: true },
          ov.overdueAP > 0 && { label: `مستحقات متأخرة: ${money(ov.overdueAP)}`, href: "/purchases/aging", danger: true },
          ov.outOfStock > 0 && { label: `أصناف نافدة: ${int(ov.outOfStock)}`, href: "/inventory/reorder", danger: true },
          ov.lowStock > 0 && { label: `مخزون منخفض: ${int(ov.lowStock)}`, href: "/inventory/reorder", danger: false },
          ov.nearExpiryCount > 0 && { label: `قرب انتهاء الصلاحية: ${int(ov.nearExpiryCount)}`, href: "/inventory/expiry", danger: false },
        ].filter(Boolean) as { label: string; href: string; danger: boolean }[])
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Activity" title="التحليلات" subtitle="كل مؤشرات الأداء والرسوم التحليلية في مكان واحد" />

        {kpis.length > 0 && (
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name={k.icon} className="size-3.5" />{k.label}</div>
                    <div className={`mt-1 text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {alerts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            {alerts.map((a) => (
              <Link key={a.label} href={a.href} className={a.danger ? "rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10" : "rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"}>
                {a.label}
              </Link>
            ))}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {hasPnl && (
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Icon name="BarChart3" className="size-5 text-primary" />الإيراد مقابل المصروف</CardTitle>
                <CardDescription>آخر ٦ أشهر — من القيود المُرحّلة.</CardDescription>
              </CardHeader>
              <CardContent>
                <GroupedBarChart
                  data={pnl}
                  series={[
                    { key: "revenue", name: "الإيراد", color: "#0d9488" },
                    { key: "expense", name: "المصروف", color: "#d97706" },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {topItems.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Icon name="Boxes" className="size-5 text-primary" />أعلى الأصناف قيمةً</CardTitle>
                <CardDescription>أكبر الأصناف من حيث قيمة المخزون.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {topItems.map((t) => (
                    <div key={t.name} className="space-y-1">
                      <div className="flex justify-between text-sm"><span className="truncate">{t.name}</span><span className="font-medium tabular-nums">{money(t.value)}</span></div>
                      <div className="h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((t.value / maxItem) * 100, 2)}%` }} /></div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  });
}
