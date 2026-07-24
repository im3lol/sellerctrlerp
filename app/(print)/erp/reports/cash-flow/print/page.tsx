import type { ReactNode } from "react";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { getCashFlow, type CashLine } from "@/lib/erp/cashflow";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);

const COLUMNS = [{ label: "البيان" }, { label: "المبلغ", align: "end" as const, width: "24%" }];

/** Accounting-style negatives: (1,234.00). */
const amt = (n: number) => (n >= 0 ? fmt(n) : `(${fmt(-n)})`);

const lineRows = (lines: CashLine[]): ReactNode[][] =>
  lines.map((l) => [`${l.code} — ${l.nameAr}`, amt(l.sign * l.amount)]);

export default async function PrintCashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const now = new Date();
    const from = sp.from || (await orgFiscalYearStartISO(orgId, now));
    const to = sp.to || iso(now);

    const [{ org }, cf] = await Promise.all([
      loadPrintHeader(orgId),
      getCashFlow(orgId, new Date(from), new Date(`${to}T23:59:59`)),
    ]);

    return (
      <ReportSheet
        org={org}
        title="قائمة التدفق النقدي"
        period={`من ${dt(from)} إلى ${dt(to)} — الطريقة غير المباشرة`}
        backHref={`/reports/cash-flow?${new URLSearchParams({ from, to }).toString()}`}
        kpis={[
          { label: "صافي التغير في النقدية", value: amt(cf.netCashChange), tone: cf.netCashChange >= 0 ? "success" : "danger" },
          { label: "رصيد النقدية أول الفترة", value: fmt(cf.cashBegin) },
          { label: "رصيد النقدية آخر الفترة", value: fmt(cf.cashEnd) },
        ]}
        sections={[
          {
            title: "الأنشطة التشغيلية",
            columns: COLUMNS,
            rows: [["صافي الربح / (الخسارة)", amt(cf.netIncome)], ...lineRows(cf.operating)],
            footerRow: ["صافي الأنشطة التشغيلية", amt(cf.opTotal)],
          },
          {
            title: "الأنشطة الاستثمارية",
            columns: COLUMNS,
            rows: lineRows(cf.investing),
            footerRow: ["صافي الأنشطة الاستثمارية", amt(cf.invTotal)],
          },
          {
            title: "الأنشطة التمويلية",
            columns: COLUMNS,
            rows: lineRows(cf.financing),
            footerRow: ["صافي الأنشطة التمويلية", amt(cf.finTotal)],
          },
        ]}
        note="* النقدية تشمل حسابات الصندوق والبنوك فقط. الطريقة غير المباشرة — التغيرات مستخرجة من قيود الأستاذ العام."
      />
    );
  });
}
