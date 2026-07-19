import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { getErpOverview } from "@/lib/erp/overview";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";

type Report = { label: string; href: string; icon: string; desc: string };
type Group = { title: string; icon: string; reports: Report[] };

// `+ 0` collapses -0 → 0 so a zero balance never prints as "‎-0".
const money = (n: number) => (n + 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Central index of every analytical page across the modules — one place to find
// any report. Purely a link hub (no queries); each target enforces its own access.
const GROUPS: Group[] = [
  {
    title: "القوائم المالية",
    icon: "ChartPie",
    reports: [
      { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie", desc: "أرصدة الحسابات مدين/دائن عن فترة" },
      { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp", desc: "الإيرادات والمصروفات وصافي الربح" },
      { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale", desc: "الأصول والخصوم وحقوق الملكية" },
      { label: "التدفق النقدي", href: "/erp/reports/cash-flow", icon: "ArrowLeftRight", desc: "حركة النقد من الأنشطة" },
      { label: "ضريبة القيمة المضافة", href: "/erp/reports/vat", icon: "Percent", desc: "ضريبة المخرجات والمدخلات المستحقة" },
    ],
  },
  {
    title: "تحليلات مالية",
    icon: "Activity",
    reports: [
      { label: "المؤشرات المالية", href: "/erp/reports/ratios", icon: "Activity", desc: "السيولة والربحية والكفاءة" },
      { label: "أرباح مراكز التكلفة", href: "/erp/reports/cost-centers", icon: "Target", desc: "الربح/الخسارة لكل مركز تكلفة" },
      { label: "إعادة تقييم العملات", href: "/erp/reports/fx-revaluation", icon: "BadgeDollarSign", desc: "أرباح/خسائر فروق العملة غير المحققة" },
      { label: "توقّع التدفق النقدي", href: "/erp/accounting/cashflow-forecast", icon: "TrendingUp", desc: "الرصيد النقدي المتوقّع للأسابيع القادمة" },
    ],
  },
  {
    title: "المطابقات",
    icon: "Scale",
    reports: [
      { label: "مطابقة قيمة المخزون", href: "/erp/inventory/valuation", icon: "Scale", desc: "دفتر المخزون مقابل حساب 1104" },
      { label: "مطابقة حسابات المراقبة", href: "/erp/accounting/control-reconciliation", icon: "Scale", desc: "أرصدة العملاء/الموردين مقابل GL" },
      { label: "المطابقة البنكية", href: "/erp/accounting/reconciliation", icon: "ListChecks", desc: "كشف البنك مقابل دفتر الأستاذ" },
    ],
  },
  {
    title: "المبيعات والعملاء",
    icon: "ShoppingCart",
    reports: [
      { label: "ربحية المنتجات", href: "/erp/sales/reports/profitability", icon: "TrendingUp", desc: "الإيراد − التكلفة وهامش الربح لكل صنف" },
      { label: "ترتيب العملاء", href: "/erp/sales/reports/customers", icon: "Users", desc: "أفضل العملاء بالإيراد والرصيد" },
      { label: "تقرير أصناف المبيعات", href: "/erp/sales/reports/items", icon: "BarChart3", desc: "المبيعات لكل صنف" },
      { label: "دفتر مبيعات", href: "/erp/sales/reports/ledger", icon: "BookOpen", desc: "حركة فواتير وسندات المبيعات" },
      { label: "أعمار الذمم المدينة", href: "/erp/sales/aging", icon: "CalendarClock", desc: "الديون المتأخرة على العملاء بالفئات العمرية" },
    ],
  },
  {
    title: "المشتريات والموردون",
    icon: "Truck",
    reports: [
      { label: "ترتيب الموردين", href: "/erp/purchases/reports/suppliers", icon: "Users", desc: "أعلى الموردين بالمشتريات والرصيد" },
      { label: "دفتر مشتريات", href: "/erp/purchases/reports/ledger", icon: "BookOpen", desc: "حركة فواتير وسندات المشتريات" },
      { label: "أعمار الذمم الدائنة", href: "/erp/purchases/aging", icon: "CalendarClock", desc: "المستحقات المتأخرة للموردين بالفئات العمرية" },
    ],
  },
  {
    title: "المخزون",
    icon: "Warehouse",
    reports: [
      { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes", desc: "الكمية والقيمة الحالية لكل صنف/مستودع" },
      { label: "المخزون الراكد", href: "/erp/inventory/dead-stock", icon: "PackageX", desc: "أصناف بطيئة/راكدة ورأس المال المحتجز" },
      { label: "تنبيهات انتهاء الصلاحية", href: "/erp/inventory/expiry", icon: "CalendarClock", desc: "الدفعات القريبة أو المنتهية الصلاحية" },
      { label: "دفتر حركة المخزون", href: "/erp/inventory/ledger", icon: "ScrollText", desc: "كل حركات الدخول/الخروج/التسوية" },
    ],
  },
  {
    title: "كشوف الحسابات والموارد البشرية",
    icon: "ScrollText",
    reports: [
      { label: "كشف حساب العميل", href: "/erp/accounting/customer-statement", icon: "ScrollText", desc: "حركة حساب عميل ورصيده" },
      { label: "كشف حساب المورّد", href: "/erp/accounting/supplier-statement", icon: "ScrollText", desc: "حركة حساب مورّد ورصيده" },
      { label: "أرصدة الإجازات", href: "/erp/hr/leaves/report", icon: "CalendarDays", desc: "الأيام المعتمدة لكل موظف حسب النوع" },
    ],
  },
];

export default async function ReportsCenterPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    // Reuse the shared overview (financial + trade + alerts) — fail-safe so the
    // report directory always renders even if the analytics fan-out hiccups.
    let ov: Awaited<ReturnType<typeof getErpOverview>> | null = null;
    try { ov = await getErpOverview(orgId); } catch { ov = null; }

    const kpis = ov
      ? [
          { label: "صافي الربح (حتى تاريخه)", value: money(ov.net), href: "/erp/reports/income-statement", icon: "TrendingUp", tone: ov.net >= 0 ? "text-emerald-600" : "text-destructive" },
          { label: "النقدية والبنك", value: money(ov.cash), href: "/erp/reports/cash-flow", icon: "Wallet", tone: "" },
          { label: "ذمم مدينة (عملاء)", value: money(ov.ar), href: "/erp/sales/aging", icon: "ArrowDownLeft", tone: "" },
          { label: "ذمم دائنة (موردون)", value: money(ov.ap), href: "/erp/purchases/aging", icon: "ArrowUpRight", tone: "" },
          { label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/erp/inventory/stock", icon: "Boxes", tone: "" },
          { label: "مبيعات هذا الشهر", value: money(ov.salesMonth), href: "/erp/sales/reports/ledger", icon: "ShoppingCart", tone: "" },
        ]
      : [];

    const pnlData = ov?.pnlTrend.map((m) => ({ label: m.label, revenue: m.revenue, expense: m.expense })) ?? [];
    const hasPnl = pnlData.some((m) => m.revenue > 0 || m.expense > 0);

    const alerts = ov
      ? [
          ov.overdueAR > 0 && { label: `ذمم متأخرة: ${money(ov.overdueAR)}`, href: "/erp/sales/aging", danger: true },
          ov.overdueAP > 0 && { label: `مستحقات متأخرة: ${money(ov.overdueAP)}`, href: "/erp/purchases/aging", danger: true },
          ov.outOfStock > 0 && { label: `أصناف نافدة: ${ov.outOfStock.toLocaleString("ar-EG-u-nu-latn")}`, href: "/erp/inventory/reorder", danger: true },
          ov.lowStock > 0 && { label: `مخزون منخفض: ${ov.lowStock.toLocaleString("ar-EG-u-nu-latn")}`, href: "/erp/inventory/reorder", danger: false },
          ov.nearExpiryCount > 0 && { label: `قرب انتهاء الصلاحية: ${ov.nearExpiryCount.toLocaleString("ar-EG-u-nu-latn")}`, href: "/erp/inventory/expiry", danger: false },
        ].filter(Boolean) as { label: string; href: string; danger: boolean }[]
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ChartColumn" title="التقارير والتحليلات" subtitle="نظرة تحليلية سريعة، وكل تقارير النظام في مكان واحد" />

        {/* Financial snapshot */}
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

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="flex flex-wrap gap-2 text-sm">
            {alerts.map((a) => (
              <Link
                key={a.label}
                href={a.href}
                className={
                  a.danger
                    ? "rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-destructive hover:bg-destructive/10"
                    : "rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                }
              >
                {a.label}
              </Link>
            ))}
          </div>
        )}

        {/* Revenue vs expense trend */}
        {hasPnl && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Icon name="BarChart3" className="size-5 text-primary" />الإيراد مقابل المصروف</CardTitle>
              <CardDescription>آخر ٦ أشهر — من القيود المُرحّلة.</CardDescription>
            </CardHeader>
            <CardContent>
              <GroupedBarChart
                data={pnlData}
                series={[
                  { key: "revenue", name: "الإيراد", color: "#0d9488" },
                  { key: "expense", name: "المصروف", color: "#d97706" },
                ]}
              />
            </CardContent>
          </Card>
        )}

        {/* Report directory */}
        <div>
          <h2 className="mb-3 mt-2 text-sm font-semibold text-muted-foreground">كل التقارير</h2>
          <div className="space-y-6">
            {GROUPS.map((g) => (
              <Card key={g.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Icon name={g.icon} className="size-5 text-primary" />{g.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {g.reports.map((r) => (
                      <Link key={r.href} href={r.href} className="group flex items-start gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary hover:bg-accent">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground">
                          <Icon name={r.icon} className="size-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{r.label}</div>
                          <div className="text-xs text-muted-foreground">{r.desc}</div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  });
}
