import { loadErpPage } from "@/lib/erp/org";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratio = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const pctv = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");

export default async function RatiosReportPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const balances = await accountBalances({ orgId });

    const byCode = Object.fromEntries(balances.map((b) => [b.code, Number(b.balance)]));
    const sumWhere = (pred: (b: (typeof balances)[number]) => boolean) => balances.filter(pred).reduce((s, b) => s + naturalAmount(b), 0);

    const revenue = sumWhere((b) => b.type === "REVENUE");
    const expenseTotal = sumWhere((b) => b.type === "EXPENSE");
    const cogs = sumWhere((b) => b.type === "EXPENSE" && (b.code ?? "").startsWith("51"));
    const opex = expenseTotal - cogs;
    const grossProfit = revenue - cogs;
    const netProfit = revenue - expenseTotal;

    const rc = await resolveAccountCodes(orgId, ["1101", "1102", "1103", "1104", "2101"]);
    const cash = (byCode[rc["1101"]] ?? 0) + (byCode[rc["1102"]] ?? 0);
    const ar = byCode[rc["1103"]] ?? 0;
    const inventory = byCode[rc["1104"]] ?? 0;
    const currentAssets = sumWhere((b) => b.type === "ASSET" && (b.code ?? "").startsWith("11"));
    const currentLiabilities = sumWhere((b) => b.type === "LIABILITY" && (b.code ?? "").startsWith("21"));
    const totalLiabilities = sumWhere((b) => b.type === "LIABILITY");
    const equity = sumWhere((b) => b.type === "EQUITY") + netProfit; // retained + current period
    const ap = byCode[rc["2101"]] ? -(byCode[rc["2101"]]) : 0;

    const currentRatio = currentAssets / currentLiabilities;
    const quickRatio = (currentAssets - inventory) / currentLiabilities;
    const workingCapital = currentAssets - currentLiabilities;
    const debtToEquity = totalLiabilities / equity;
    const grossMargin = grossProfit / revenue;
    const netMargin = netProfit / revenue;
    const dso = ar / (revenue / 365);
    const dpo = cogs > 0 ? ap / (cogs / 365) : NaN;
    const invTurnover = cogs / inventory;

    const Metric = ({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) => (
      <Card><CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent></Card>
    );

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Activity" title="المؤشرات المالية" subtitle="نسب السيولة والربحية والملاءة من أرصدة الأستاذ الحالية" action={<ReportToolbar />} />

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">السيولة</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="النسبة الجارية" value={ratio(currentRatio)} hint="أصول متداولة ÷ خصوم متداولة" tone={currentRatio >= 1 ? "text-emerald-600" : "text-destructive"} />
            <Metric label="النسبة السريعة" value={ratio(quickRatio)} hint="بدون المخزون" />
            <Metric label="رأس المال العامل" value={fmt(workingCapital)} tone={workingCapital >= 0 ? "" : "text-destructive"} />
            <Metric label="النقدية والبنك" value={fmt(cash)} />
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الربحية</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="هامش الربح الإجمالي" value={pctv(grossMargin)} hint={`إجمالي ${fmt(grossProfit)}`} tone={grossProfit >= 0 ? "text-emerald-600" : "text-destructive"} />
            <Metric label="هامش الربح الصافي" value={pctv(netMargin)} hint={`صافي ${fmt(netProfit)}`} tone={netProfit >= 0 ? "text-emerald-600" : "text-destructive"} />
            <Metric label="الإيراد" value={fmt(revenue)} />
            <Metric label="المصروفات التشغيلية" value={fmt(opex)} />
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">الكفاءة والملاءة</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="متوسط تحصيل الذمم (يوم)" value={ratio(dso)} hint="DSO — ذمم مدينة ÷ متوسط البيع اليومي" />
            <Metric label="متوسط سداد الموردين (يوم)" value={ratio(dpo)} hint="DPO" />
            <Metric label="معدّل دوران المخزون" value={ratio(invTurnover)} hint="تكلفة المبيعات ÷ المخزون" />
            <Metric label="الدين إلى حقوق الملكية" value={ratio(debtToEquity)} hint="إجمالي الخصوم ÷ حقوق الملكية" tone={debtToEquity <= 2 ? "" : "text-amber-600"} />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">المؤشرات محسوبة من أرصدة الأستاذ الحالية؛ نسب النشاط (DSO/DPO/الدوران) تفترض الأرصدة الجارية معدّلاً سنوياً — للإرشاد لا للتقارير الرسمية.</p>
      </div>
    );
  });
}
