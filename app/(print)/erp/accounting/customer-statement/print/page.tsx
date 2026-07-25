import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesInvoices, receiptVouchers, salesReturns } from "@/db/schema";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { customerId?: string; from?: string; to?: string };

type TxRow = {
  date: Date;
  number: string;
  type: "invoice" | "receipt" | "return";
  description: string;
  debit: number;
  credit: number;
};

const TYPE_AR: Record<TxRow["type"], string> = { invoice: "فاتورة", receipt: "قبض", return: "مرتجع" };

export default async function PrintCustomerStatementPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const sp = await searchParams;
    const selectedId = sp.customerId ?? "";

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = sp.from ? new Date(sp.from) : firstOfMonth;
    const toDate = sp.to ? new Date(sp.to) : now;

    const { org, currency } = await loadPrintHeader(orgId);

    const backQs = new URLSearchParams();
    if (selectedId) backQs.set("customerId", selectedId);
    if (sp.from) backQs.set("from", sp.from);
    if (sp.to) backQs.set("to", sp.to);
    const backHref = `/accounting/customer-statement${backQs.size ? `?${backQs}` : ""}`;

    if (!selectedId) {
      return <ReportSheet org={org} title="كشف حساب العميل" sections={[]} note="اختر عميلاً أولاً." backHref={backHref} />;
    }

    const [cust] = await db
      .select({ id: customers.id, nameAr: customers.nameAr })
      .from(customers)
      .where(and(eq(customers.organizationId, orgId), eq(customers.id, selectedId)))
      .limit(1);

    // Opening balance: invoices − receipts − returns BEFORE the period.
    const obResult = await db.execute<{ balance: string }>(sql`
      SELECT
        COALESCE(SUM(si.total_amount), 0) - COALESCE(SUM(rv.amount), 0) - COALESCE(SUM(sr.total_amount), 0) AS balance
      FROM (SELECT 1) AS dummy
      LEFT JOIN (SELECT total_amount FROM sales_invoices
                  WHERE organization_id = ${orgId} AND customer_id = ${selectedId}
                    AND status NOT IN ('DRAFT','CANCELLED')
                    AND date < ${fromDate}) si ON true
      LEFT JOIN (SELECT amount FROM receipt_vouchers
                  WHERE organization_id = ${orgId} AND customer_id = ${selectedId}
                    AND status = 'POSTED'
                    AND date < ${fromDate}) rv ON true
      LEFT JOIN (SELECT total_amount FROM sales_returns
                  WHERE organization_id = ${orgId} AND customer_id = ${selectedId}
                    AND status = 'CONFIRMED'
                    AND date < ${fromDate}) sr ON true
    `);
    const openingBalance = Number(obResult.rows[0]?.balance ?? 0);

    const [invRows, recRows, retRows] = await Promise.all([
      db.select({ number: salesInvoices.number, date: salesInvoices.date, totalAmount: salesInvoices.totalAmount })
        .from(salesInvoices)
        .where(and(
          eq(salesInvoices.organizationId, orgId),
          eq(salesInvoices.customerId, selectedId),
          sql`${salesInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
        ))
        .orderBy(asc(salesInvoices.date), asc(salesInvoices.number)),
      db.select({ number: receiptVouchers.number, date: receiptVouchers.date, amount: receiptVouchers.amount, reference: receiptVouchers.reference })
        .from(receiptVouchers)
        .where(and(
          eq(receiptVouchers.organizationId, orgId),
          eq(receiptVouchers.customerId, selectedId),
          eq(receiptVouchers.status, "POSTED"),
          gte(receiptVouchers.date, fromDate),
          lte(receiptVouchers.date, toDate),
        ))
        .orderBy(asc(receiptVouchers.date), asc(receiptVouchers.number)),
      db.select({ number: salesReturns.number, date: salesReturns.date, totalAmount: salesReturns.totalAmount })
        .from(salesReturns)
        .where(and(
          eq(salesReturns.organizationId, orgId),
          eq(salesReturns.customerId, selectedId),
          eq(salesReturns.status, "CONFIRMED"),
          gte(salesReturns.date, fromDate),
          lte(salesReturns.date, toDate),
        ))
        .orderBy(asc(salesReturns.date), asc(salesReturns.number)),
    ]);

    const txRows: TxRow[] = [
      ...invRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "invoice", description: `فاتورة بيع ${r.number}`, debit: Number(r.totalAmount), credit: 0 })),
      ...recRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "receipt", description: `سند قبض ${r.number}${r.reference ? ` — ${r.reference}` : ""}`, debit: 0, credit: Number(r.amount) })),
      ...retRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "return", description: `مرتجع مبيعات ${r.number}`, debit: 0, credit: Number(r.totalAmount) })),
    ];
    txRows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));

    let runBalance = openingBalance;
    const rows = txRows.map((t) => {
      runBalance = runBalance + t.debit - t.credit;
      return { ...t, balance: runBalance };
    });
    const closingBalance = runBalance;
    const debitTotal = txRows.reduce((s, r) => s + r.debit, 0);
    const creditTotal = txRows.reduce((s, r) => s + r.credit, 0);

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
              TYPE_AR[r.type],
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
