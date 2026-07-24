import { loadErpPage } from "@/lib/erp/org";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet, type ReportSection } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);

const COLUMNS = [
  { label: "الكود", width: "14%" },
  { label: "الحساب" },
  { label: "المبلغ", align: "end" as const, width: "22%" },
];

export default async function PrintBalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>;
}) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const to = sp.to || iso(new Date());

    const [{ org }, balances] = await Promise.all([
      loadPrintHeader(orgId),
      accountBalances({ orgId, to: new Date(`${to}T23:59:59`) }),
    ]);

    const pick = (type: string) =>
      balances
        .filter((b) => b.type === type)
        .map((b) => ({ ...b, amount: naturalAmount(b) }))
        .filter((b) => b.amount !== 0);

    const assets = pick("ASSET");
    const liabilities = pick("LIABILITY");
    const equity = pick("EQUITY");

    const totalAssets = assets.reduce((s, b) => s + b.amount, 0);
    const totalLiabilities = liabilities.reduce((s, b) => s + b.amount, 0);
    const totalEquityAccounts = equity.reduce((s, b) => s + b.amount, 0);

    const netIncome =
      balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
      balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);

    const totalEquity = totalEquityAccounts + netIncome;

    const row = (r: { code: string; nameAr: string; amount: number }) => [
      <span key="c" dir="ltr">{r.code}</span>,
      r.nameAr,
      fmt(r.amount),
    ];

    const sections: ReportSection[] = [
      {
        title: "الأصول",
        columns: COLUMNS,
        rows: assets.map(row),
        footerRow: ["إجمالي الأصول", "", fmt(totalAssets)],
      },
      {
        title: "الخصوم",
        columns: COLUMNS,
        rows: liabilities.map(row),
        footerRow: ["إجمالي الخصوم", "", fmt(totalLiabilities)],
      },
      {
        title: "حقوق الملكية",
        columns: COLUMNS,
        rows: [...equity.map(row), ["—", "صافي ربح/خسارة الفترة", fmt(netIncome)]],
        footerRow: ["إجمالي حقوق الملكية", "", fmt(totalEquity)],
      },
    ];

    return (
      <ReportSheet
        org={org}
        title="الميزانية العمومية"
        period={`كما في ${dt(to)} — من القيود المُرحّلة`}
        backHref={`/reports/balance-sheet?to=${to}`}
        kpis={[
          { label: "إجمالي الأصول", value: fmt(totalAssets) },
          { label: "إجمالي الخصوم", value: fmt(totalLiabilities) },
          { label: "حقوق الملكية", value: fmt(totalEquity), tone: totalEquity >= 0 ? "success" : "danger" },
        ]}
        sections={sections}
      />
    );
  });
}
