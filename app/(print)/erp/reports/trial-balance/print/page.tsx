import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { accountBalances } from "@/lib/erp/financials";
import { fmt, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const MAX_ROWS = 3000;

export default async function PrintTrialBalancePage({
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
      accountBalances({ orgId, from: new Date(from), to: new Date(`${to}T23:59:59`) }),
    ]);

    const lines = balances
      .filter((b) => b.debit !== 0 || b.credit !== 0)
      .map((b) => ({
        code: b.code,
        nameAr: b.nameAr,
        debit: b.balance > 0 ? b.balance : 0,
        credit: b.balance < 0 ? -b.balance : 0,
      }));
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    const shown = lines.slice(0, MAX_ROWS);

    return (
      <ReportSheet
        org={org}
        title="ميزان المراجعة"
        period={`من ${dt(from)} إلى ${dt(to)} — من القيود المُرحّلة`}
        backHref={`/reports?${new URLSearchParams({ from, to }).toString()}`}
        sections={[
          {
            columns: [
              { label: "الكود", width: "14%" },
              { label: "الحساب" },
              { label: "مدين", align: "end", width: "18%" },
              { label: "دائن", align: "end", width: "18%" },
            ],
            rows: shown.map((l) => [
              <span key="c" dir="ltr">{l.code}</span>,
              l.nameAr,
              l.debit ? fmt(l.debit) : "—",
              l.credit ? fmt(l.credit) : "—",
            ]),
            footerRow: ["الإجمالي", "", fmt(totalDebit), fmt(totalCredit)],
          },
        ]}
        note={lines.length > MAX_ROWS ? `عُرضت أول ${MAX_ROWS} صف من ${lines.length}.` : null}
      />
    );
  });
}
