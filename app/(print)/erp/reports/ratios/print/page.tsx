import { loadErpPage } from "@/lib/erp/org";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { fmt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const ratio = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "—");
const pctv = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");

export default async function PrintRatiosReportPage() {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const [{ org }, balances] = await Promise.all([loadPrintHeader(orgId), accountBalances({ orgId })]);

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
    const equity = sumWhere((b) => b.type === "EQUITY") + netProfit;
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

    const columns = [
      { label: "المؤشر", width: "60%" },
      { label: "القيمة", align: "end" as const },
    ];
    const row = (label: string, value: string, hint?: string, bad?: boolean) => [
      <span key="l">
        {label}
        {hint && <span style={{ color: "#8a93a6", fontSize: 9.5, marginInlineStart: 6 }}>{hint}</span>}
      </span>,
      <b key="v" style={bad ? { color: "#d64545" } : undefined}>{value}</b>,
    ];

    return (
      <ReportSheet
        org={org}
        title="المؤشرات المالية"
        backHref="/reports/ratios"
        sections={[
          {
            title: "السيولة",
            columns,
            rows: [
              row("النسبة الجارية", ratio(currentRatio), "أصول متداولة ÷ خصوم متداولة", currentRatio < 1),
              row("النسبة السريعة", ratio(quickRatio), "بدون المخزون"),
              row("رأس المال العامل", fmt(workingCapital), undefined, workingCapital < 0),
              row("النقدية والبنك", fmt(cash)),
            ],
          },
          {
            title: "الربحية",
            columns,
            rows: [
              row("هامش الربح الإجمالي", pctv(grossMargin), `إجمالي ${fmt(grossProfit)}`, grossProfit < 0),
              row("هامش الربح الصافي", pctv(netMargin), `صافي ${fmt(netProfit)}`, netProfit < 0),
              row("الإيراد", fmt(revenue)),
              row("المصروفات التشغيلية", fmt(opex)),
            ],
          },
          {
            title: "الكفاءة والملاءة",
            columns,
            rows: [
              row("متوسط تحصيل الذمم (يوم)", ratio(dso), "DSO — ذمم مدينة ÷ متوسط البيع اليومي"),
              row("متوسط سداد الموردين (يوم)", ratio(dpo), "DPO"),
              row("معدّل دوران المخزون", ratio(invTurnover), "تكلفة المبيعات ÷ المخزون"),
              row("الدين إلى حقوق الملكية", ratio(debtToEquity), "إجمالي الخصوم ÷ حقوق الملكية"),
            ],
          },
        ]}
        note="المؤشرات محسوبة من أرصدة الأستاذ الحالية؛ نسب النشاط (DSO/DPO/الدوران) تفترض الأرصدة الجارية معدّلاً سنوياً — للإرشاد لا للتقارير الرسمية."
      />
    );
  });
}
