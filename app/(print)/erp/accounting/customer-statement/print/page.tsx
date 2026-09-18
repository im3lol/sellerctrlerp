import { loadErpPage } from "@/lib/erp/org";
import { getPartyStatement, statementPeriod, STATEMENT_TYPE_AR } from "@/lib/erp/party-statement";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { customerId?: string; from?: string; to?: string };

export default async function PrintCustomerStatementPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const sp = await searchParams;
    const selectedId = sp.customerId ?? "";

    const { from: fromDate, to: toDate } = statementPeriod(sp);

    const { org, currency } = await loadPrintHeader(orgId);

    const backQs = new URLSearchParams();
    if (selectedId) backQs.set("customerId", selectedId);
    if (sp.from) backQs.set("from", sp.from);
    if (sp.to) backQs.set("to", sp.to);
    const backHref = `/accounting/customer-statement${backQs.size ? `?${backQs}` : ""}`;

    if (!selectedId) {
      return <ReportSheet org={org} title="كشف حساب العميل" sections={[]} note="اختر عميلاً أولاً." backHref={backHref} />;
    }

    const st = await getPartyStatement(orgId, "customer", selectedId, fromDate, toDate);
    const cust = st.name ? { nameAr: st.name } : null;
    const { opening: openingBalance, rows, closing: closingBalance, debitTotal, creditTotal } = st;

    return (
      <ReportSheet
        org={org}
        title="كشف حساب العميل"
        period={`من ${dt(fromDate)} إلى ${dt(toDate)}`}
        backHref={backHref}
        filters={[{ label: "العميل", value: cust?.nameAr ?? "—" }]}
        kpis={[
          { label: "رصيد الافتتاح", value: money(openingBalance, currency) },
          { label: "إجمالي الفواتير", value: money(debitTotal, currency) },
          { label: "إجمالي المقبوضات", value: money(creditTotal, currency), tone: "success" },
          {
            label: closingBalance >= 0 ? "الرصيد المدين (مستحق)" : "رصيد زائد (دائن)",
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
              openingBalance > 0 ? fmt(openingBalance) : "—",
              openingBalance < 0 ? fmt(-openingBalance) : "—",
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
            `${fmt(closingBalance)}${closingBalance > 0 ? " (مدين)" : closingBalance < 0 ? " (دائن)" : ""}`,
          ],
        }]}
        note={rows.length === 0 ? "لا توجد حركات في هذه الفترة." : null}
      />
    );
  });
}
