import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);

const COLUMNS = [
  { label: "الكود", width: "14%" },
  { label: "الحساب" },
  { label: "المبلغ", align: "end" as const, width: "22%" },
];

export default async function PrintIncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const now = new Date();
    const from = sp.from || (await orgFiscalYearStartISO(orgId, now));
    const to = sp.to || iso(now);

    const [{ org }, balances] = await Promise.all([
      loadPrintHeader(orgId),
      accountBalances({ orgId, from: new Date(from), to: new Date(`${to}T23:59:59`), excludeClosing: true }),
    ]);

    const pick = (type: string) =>
      balances
        .filter((b) => b.type === type)
        .map((b) => ({ ...b, amount: naturalAmount(b) }))
        .filter((b) => b.amount !== 0);

    const revenue = pick("REVENUE");
    const expense = pick("EXPENSE");
    const totalRevenue = revenue.reduce((s, b) => s + b.amount, 0);
    const totalExpense = expense.reduce((s, b) => s + b.amount, 0);
    const netProfit = totalRevenue - totalExpense;

    const row = (r: { code: string; nameAr: string; amount: number }) => [
      <span key="c" dir="ltr">{r.code}</span>,
      r.nameAr,
      fmt(r.amount),
    ];

    return (
      <ReportSheet
        org={org}
        title="قائمة الدخل"
        period={`من ${dt(from)} إلى ${dt(to)} — من القيود المُرحّلة`}
        backHref={`/reports/income-statement?${new URLSearchParams({ from, to }).toString()}`}
        kpis={[
          { label: "إجمالي الإيرادات", value: fmt(totalRevenue), tone: "success" },
          { label: "إجمالي المصروفات", value: fmt(totalExpense), tone: "danger" },
          { label: "صافي الربح / (الخسارة)", value: fmt(netProfit), tone: netProfit >= 0 ? "success" : "danger" },
        ]}
        sections={[
          {
            title: "الإيرادات",
            columns: COLUMNS,
            rows: revenue.map(row),
            footerRow: ["إجمالي الإيرادات", "", fmt(totalRevenue)],
          },
          {
            title: "المصروفات",
            columns: COLUMNS,
            rows: expense.map(row),
            footerRow: ["إجمالي المصروفات", "", fmt(totalExpense)],
          },
        ]}
      />
    );
  });
}
