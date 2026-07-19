import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { getErpOverview } from "@/lib/erp/overview";
import { Card, CardContent } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { ReportBrowser, type BrowserReport } from "@/components/erp/report-browser";

const money = (n: number) => (n + 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

// Every analytical page across the modules, in one searchable browser. `excel`
// points at the export route (year-to-date defaults) where one exists.
const REPORTS: BrowserReport[] = [
  // القوائم المالية
  { key: "trial-balance", category: "القوائم المالية", label: "ميزان المراجعة", desc: "أرصدة الحسابات مدين/دائن عن فترة", icon: "ChartPie", href: "/erp/reports", excel: "/api/erp/reports/trial-balance/export" },
  { key: "income-statement", category: "القوائم المالية", label: "قائمة الدخل", desc: "الإيرادات والمصروفات وصافي الربح", icon: "TrendingUp", href: "/erp/reports/income-statement", excel: "/api/erp/reports/income-statement/export" },
  { key: "balance-sheet", category: "القوائم المالية", label: "الميزانية العمومية", desc: "الأصول والخصوم وحقوق الملكية", icon: "Scale", href: "/erp/reports/balance-sheet", excel: "/api/erp/reports/balance-sheet/export" },
  { key: "cash-flow", category: "القوائم المالية", label: "التدفق النقدي", desc: "حركة النقد من الأنشطة", icon: "ArrowLeftRight", href: "/erp/reports/cash-flow", excel: "/api/erp/reports/cash-flow/export" },
  { key: "vat", category: "القوائم المالية", label: "ضريبة القيمة المضافة", desc: "ضريبة المخرجات والمدخلات المستحقة", icon: "Percent", href: "/erp/reports/vat", excel: "/api/erp/reports/vat/export" },
  // تحليلات مالية
  { key: "ratios", category: "تحليلات مالية", label: "المؤشرات المالية", desc: "السيولة والربحية والكفاءة", icon: "Activity", href: "/erp/reports/ratios" },
  { key: "cost-centers", category: "تحليلات مالية", label: "أرباح مراكز التكلفة", desc: "الربح/الخسارة لكل مركز تكلفة", icon: "Target", href: "/erp/reports/cost-centers" },
  { key: "fx", category: "تحليلات مالية", label: "إعادة تقييم العملات", desc: "أرباح/خسائر فروق العملة غير المحققة", icon: "BadgeDollarSign", href: "/erp/reports/fx-revaluation" },
  { key: "cashflow-forecast", category: "تحليلات مالية", label: "توقّع التدفق النقدي", desc: "الرصيد النقدي المتوقّع للأسابيع القادمة", icon: "TrendingUp", href: "/erp/accounting/cashflow-forecast" },
  // المطابقات
  { key: "inv-valuation", category: "المطابقات", label: "مطابقة قيمة المخزون", desc: "دفتر المخزون مقابل حساب 1104", icon: "Scale", href: "/erp/inventory/valuation" },
  { key: "control-recon", category: "المطابقات", label: "مطابقة حسابات المراقبة", desc: "أرصدة العملاء/الموردين مقابل GL", icon: "Scale", href: "/erp/accounting/control-reconciliation" },
  { key: "bank-recon", category: "المطابقات", label: "المطابقة البنكية", desc: "كشف البنك مقابل دفتر الأستاذ", icon: "ListChecks", href: "/erp/accounting/reconciliation" },
  // المبيعات والعملاء
  { key: "sales-profit", category: "المبيعات والعملاء", label: "ربحية المنتجات", desc: "الإيراد − التكلفة وهامش الربح لكل صنف", icon: "TrendingUp", href: "/erp/sales/reports/profitability" },
  { key: "sales-customers", category: "المبيعات والعملاء", label: "ترتيب العملاء", desc: "أفضل العملاء بالإيراد والرصيد", icon: "Users", href: "/erp/sales/reports/customers" },
  { key: "sales-items", category: "المبيعات والعملاء", label: "تقرير أصناف المبيعات", desc: "المبيعات لكل صنف", icon: "BarChart3", href: "/erp/sales/reports/items" },
  { key: "sales-ledger", category: "المبيعات والعملاء", label: "دفتر مبيعات", desc: "حركة فواتير وسندات المبيعات", icon: "BookOpen", href: "/erp/sales/reports/ledger", excel: "/api/erp/sales/ledger/export" },
  { key: "sales-aging", category: "المبيعات والعملاء", label: "أعمار الذمم المدينة", desc: "الديون المتأخرة على العملاء بالفئات العمرية", icon: "CalendarClock", href: "/erp/sales/aging", excel: "/api/erp/sales/aging/export" },
  // المشتريات والموردون
  { key: "purch-suppliers", category: "المشتريات والموردون", label: "ترتيب الموردين", desc: "أعلى الموردين بالمشتريات والرصيد", icon: "Users", href: "/erp/purchases/reports/suppliers" },
  { key: "purch-ledger", category: "المشتريات والموردون", label: "دفتر مشتريات", desc: "حركة فواتير وسندات المشتريات", icon: "BookOpen", href: "/erp/purchases/reports/ledger", excel: "/api/erp/purchases/ledger/export" },
  { key: "purch-aging", category: "المشتريات والموردون", label: "أعمار الذمم الدائنة", desc: "المستحقات المتأخرة للموردين بالفئات العمرية", icon: "CalendarClock", href: "/erp/purchases/aging", excel: "/api/erp/purchases/aging/export" },
  // المخزون
  { key: "inv-stock", category: "المخزون", label: "أرصدة المخزون", desc: "الكمية والقيمة الحالية لكل صنف/مستودع", icon: "Boxes", href: "/erp/inventory/stock", excel: "/api/erp/inventory/stock/export" },
  { key: "inv-dead", category: "المخزون", label: "المخزون الراكد", desc: "أصناف بطيئة/راكدة ورأس المال المحتجز", icon: "PackageX", href: "/erp/inventory/dead-stock" },
  { key: "inv-expiry", category: "المخزون", label: "تنبيهات انتهاء الصلاحية", desc: "الدفعات القريبة أو المنتهية الصلاحية", icon: "CalendarClock", href: "/erp/inventory/expiry" },
  { key: "inv-ledger", category: "المخزون", label: "دفتر حركة المخزون", desc: "كل حركات الدخول/الخروج/التسوية", icon: "ScrollText", href: "/erp/inventory/ledger", excel: "/api/erp/inventory/ledger/export" },
  // كشوف الحسابات والموارد البشرية
  { key: "cust-statement", category: "كشوف الحسابات والموارد البشرية", label: "كشف حساب العميل", desc: "حركة حساب عميل ورصيده", icon: "ScrollText", href: "/erp/accounting/customer-statement" },
  { key: "supp-statement", category: "كشوف الحسابات والموارد البشرية", label: "كشف حساب المورّد", desc: "حركة حساب مورّد ورصيده", icon: "ScrollText", href: "/erp/accounting/supplier-statement" },
  { key: "leave-balances", category: "كشوف الحسابات والموارد البشرية", label: "أرصدة الإجازات", desc: "الأيام المعتمدة لكل موظف حسب النوع", icon: "CalendarDays", href: "/erp/hr/leaves/report", excel: "/api/erp/hr/leaves/report/export" },
];

export default async function ReportsCenterPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    // A compact financial snapshot — the detail lives in each report.
    let ov: Awaited<ReturnType<typeof getErpOverview>> | null = null;
    try { ov = await getErpOverview(orgId); } catch { ov = null; }

    const kpis = ov
      ? [
          { label: "صافي الربح", value: money(ov.net), href: "/erp/reports/income-statement", tone: ov.net >= 0 ? "text-emerald-600" : "text-destructive" },
          { label: "النقدية والبنك", value: money(ov.cash), href: "/erp/reports/cash-flow", tone: "" },
          { label: "ذمم مدينة", value: money(ov.ar), href: "/erp/sales/aging", tone: "" },
          { label: "ذمم دائنة", value: money(ov.ap), href: "/erp/purchases/aging", tone: "" },
          { label: "قيمة المخزون", value: money(ov.inventoryValue), href: "/erp/inventory/stock", tone: "" },
          { label: "مبيعات الشهر", value: money(ov.salesMonth), href: "/erp/sales/reports/ledger", tone: "" },
        ]
      : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ChartColumn" title="التقارير والتحليلات" subtitle="ابحث عن أي تقرير، اعرضه، أو حمّله Excel — من مكان واحد" />

        {/* Slim financial snapshot */}
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {kpis.map((k) => (
              <Link key={k.label} href={k.href}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardContent className="p-3">
                    <div className="text-[11px] text-muted-foreground">{k.label}</div>
                    <div className={`mt-0.5 text-base font-bold tabular-nums ${k.tone}`}>{k.value}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}

        <ReportBrowser reports={REPORTS} />
      </div>
    );
  });
}
