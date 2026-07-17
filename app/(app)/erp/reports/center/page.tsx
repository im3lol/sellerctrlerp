import Link from "next/link";
import { loadErpPage } from "@/lib/erp/org";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";

type Report = { label: string; href: string; icon: string; desc: string };
type Group = { title: string; icon: string; reports: Report[] };

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
  return loadErpPage("reports.view", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ChartColumn" title="مركز التقارير" subtitle="كل التحاليل والتقارير عبر النظام في مكان واحد" />
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
    );
  });
}
