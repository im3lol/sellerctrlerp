import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseInvoices, paymentVouchers, purchaseReturns } from "@/db/schema";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { supplierId?: string; from?: string; to?: string };

type TxRow = {
  date: Date;
  number: string;
  type: "invoice" | "payment" | "return";
  description: string;
  debit: number;   // payment/return reduces what we owe
  credit: number;  // invoice increases what we owe
};

const TYPE_AR: Record<TxRow["type"], string> = { invoice: "فاتورة", payment: "دفع", return: "مرتجع" };

export default async function PrintSupplierStatementPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const sp = await searchParams;
    const selectedId = sp.supplierId ?? "";

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = sp.from ? new Date(sp.from) : firstOfMonth;
    const toDate = sp.to ? new Date(sp.to) : now;

    const { org, currency } = await loadPrintHeader(orgId);

    const backQs = new URLSearchParams();
    if (selectedId) backQs.set("supplierId", selectedId);
    if (sp.from) backQs.set("from", sp.from);
    if (sp.to) backQs.set("to", sp.to);
    const backHref = `/accounting/supplier-statement${backQs.size ? `?${backQs}` : ""}`;

    if (!selectedId) {
      return <ReportSheet org={org} title="كشف حساب المورّد" sections={[]} note="اختر مورّدًا أولاً." backHref={backHref} />;
    }

    const [supp] = await db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, orgId), eq(suppliers.id, selectedId)))
      .limit(1);

    // Opening balance: invoices − payments − returns BEFORE the period.
    const obResult = await db.execute<{ balance: string }>(sql`
      SELECT
        COALESCE(SUM(pi.total_amount), 0) - COALESCE(SUM(pv.amount), 0) - COALESCE(SUM(pr.total_amount), 0) AS balance
      FROM (SELECT 1) AS dummy
      LEFT JOIN (SELECT total_amount FROM purchase_invoices
                  WHERE organization_id = ${orgId} AND supplier_id = ${selectedId}
                    AND status NOT IN ('DRAFT','CANCELLED')
                    AND date < ${fromDate}) pi ON true
      LEFT JOIN (SELECT amount FROM payment_vouchers
                  WHERE organization_id = ${orgId} AND supplier_id = ${selectedId}
                    AND status = 'POSTED'
                    AND date < ${fromDate}) pv ON true
      LEFT JOIN (SELECT total_amount FROM purchase_returns
                  WHERE organization_id = ${orgId} AND supplier_id = ${selectedId}
                    AND status = 'CONFIRMED'
                    AND date < ${fromDate}) pr ON true
    `);
    const openingBalance = Number(obResult.rows[0]?.balance ?? 0);

    const [invRows, payRows, retRows] = await Promise.all([
      db.select({ number: purchaseInvoices.number, date: purchaseInvoices.date, totalAmount: purchaseInvoices.totalAmount })
        .from(purchaseInvoices)
        .where(and(
          eq(purchaseInvoices.organizationId, orgId),
          eq(purchaseInvoices.supplierId, selectedId),
          sql`${purchaseInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
          gte(purchaseInvoices.date, fromDate),
          lte(purchaseInvoices.date, toDate),
        ))
        .orderBy(asc(purchaseInvoices.date), asc(purchaseInvoices.number)),
      db.select({ number: paymentVouchers.number, date: paymentVouchers.date, amount: paymentVouchers.amount, reference: paymentVouchers.reference })
        .from(paymentVouchers)
        .where(and(
          eq(paymentVouchers.organizationId, orgId),
          eq(paymentVouchers.supplierId, selectedId),
          eq(paymentVouchers.status, "POSTED"),
          gte(paymentVouchers.date, fromDate),
          lte(paymentVouchers.date, toDate),
        ))
        .orderBy(asc(paymentVouchers.date), asc(paymentVouchers.number)),
      db.select({ number: purchaseReturns.number, date: purchaseReturns.date, totalAmount: purchaseReturns.totalAmount })
        .from(purchaseReturns)
        .where(and(
          eq(purchaseReturns.organizationId, orgId),
          eq(purchaseReturns.supplierId, selectedId),
          eq(purchaseReturns.status, "CONFIRMED"),
          gte(purchaseReturns.date, fromDate),
          lte(purchaseReturns.date, toDate),
        ))
        .orderBy(asc(purchaseReturns.date), asc(purchaseReturns.number)),
    ]);

    const txRows: TxRow[] = [
      ...invRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "invoice", description: `فاتورة شراء ${r.number}`, debit: 0, credit: Number(r.totalAmount) })),
      ...payRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "payment", description: `سند دفع ${r.number}${r.reference ? ` — ${r.reference}` : ""}`, debit: Number(r.amount), credit: 0 })),
      ...retRows.map((r): TxRow => ({ date: r.date, number: r.number, type: "return", description: `مرتجع مشتريات ${r.number}`, debit: Number(r.totalAmount), credit: 0 })),
    ];
    txRows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));

    let runBalance = openingBalance;
    const rows = txRows.map((t) => {
      runBalance = runBalance + t.credit - t.debit;
      return { ...t, balance: runBalance };
    });
    const closingBalance = runBalance;
    const debitTotal = txRows.reduce((s, r) => s + r.debit, 0);
    const creditTotal = txRows.reduce((s, r) => s + r.credit, 0);

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
            `${fmt(closingBalance)}${closingBalance > 0 ? " (دائن)" : closingBalance < 0 ? " (مدين)" : ""}`,
          ],
        }]}
        note={rows.length === 0 ? "لا توجد حركات في هذه الفترة." : null}
      />
    );
  });
}
