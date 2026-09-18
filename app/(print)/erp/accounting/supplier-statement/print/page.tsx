import { loadErpPage } from "@/lib/erp/org";
import { getPartyStatement, statementPeriod, STATEMENT_TYPE_AR } from "@/lib/erp/party-statement";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { supplierId?: string; from?: string; to?: string };

export default async function PrintSupplierStatementPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const sp = await searchParams;
    const selectedId = sp.supplierId ?? "";

    const { from: fromDate, to: toDate } = statementPeriod(sp);

    const { org, currency } = await loadPrintHeader(orgId);

    const backQs = new URLSearchParams();
    if (selectedId) backQs.set("supplierId", selectedId);
    if (sp.from) backQs.set("from", sp.from);
    if (sp.to) backQs.set("to", sp.to);
    const backHref = `/accounting/supplier-statement${backQs.size ? `?${backQs}` : ""}`;

    if (!selectedId) {
      return <ReportSheet org={org} title="كشف حساب المورّد" sections={[]} note="اختر مورّدًا أولاً." backHref={backHref} />;
    }

    const st = await getPartyStatement(orgId, "supplier", selectedId, fromDate, toDate);
    const supp = st.name ? { nameAr: st.name } : null;
    const { opening: openingBalance, rows, closing: closingBalance, debitTotal, creditTotal } = st;

    return (
      <ReportSheet
        org={org}
        title="كشف حساب المورّد"
        period={`من ${dt(fromDate)} إلى ${dt(toDate)}`}
        backHref={backHref}
        filters={[{ label: "المورّد", value: supp?.nameAr ?? "—" }]}
        kpis={[
          { label: "رصيد الافتتاح", value: money(openingBalance, currency) },
          { label: "إجمالي الفواتير", value: money(creditTotal, currency) },
          { label: "إجمالي المدفوعات", value: money(debitTotal, currency), tone: "success" },
          {
            label: closingBalance >= 0 ? "الرصيد الدائن (مستحق)" : "رصيد زائد (دفعنا زيادة)",
            value: money(Math.abs(closingBalance), currency),
            tone: closingBalance > 0 ? "danger" : "success",
          },
        ]}
        sections={[{
          columns: [
            { label: "التاريخ", width: "12%" },
            { label: "المستند", width: "13%" },
            { label: "البيان", width: "30%" },
            { label: "النوع", width: "9%" },
            { label: "مدين", align: "end", width: "12%" },
            { label: "دائن", align: "end", width: "12%" },
            { label: "الرصيد", align: "end", width: "12%" },
          ],
          rows: [
            [
              dt(fromDate),
              "—",
              <b key="o">رصيد افتتاحي</b>,
              "",
              openingBalance < 0 ? fmt(-openingBalance) : "—",
              openingBalance > 0 ? fmt(openingBalance) : "—",
              <b key="b">{fmt(openingBalance)}</b>,
            ],
            ...rows.map((r) => [
              dt(r.date),
              <span key="n" dir="ltr" style={{ display: "block", textAlign: "start" }}>{r.number}</span>,
              r.description,
              STATEMENT_TYPE_AR[r.type],
              r.debit > 0 ? fmt(r.debit) : "—",
              r.credit > 0 ? fmt(r.credit) : "—",
              fmt(r.balance),
            ]),
          ],
          footerRow: [
            "الرصيد الختامي", "", "", "",
            fmt(debitTotal),
            fmt(creditTotal),
            `${fmt(closingBalance)}${closingBalance > 0 ? " (دائن)" : closingBalance < 0 ? " (مدين)" : ""}`,
          ],
        }]}
        note={rows.length === 0 ? "لا توجد حركات في هذه الفترة." : null}
      />
    );
  });
}
