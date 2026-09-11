import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { customers, salesInvoices, receiptVouchers, salesReturns } from "@/db/schema";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { selectCls } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FormCombobox } from "@/components/erp/form-combobox";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { money } from "@/lib/erp/print-format";

type Params = { searchParams: Promise<{ customerId?: string; from?: string; to?: string }> };

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateStr = (d: Date) => new Date(d).toLocaleDateString("ar-EG");

type TxRow = {
  date: Date;
  number: string;
  type: "invoice" | "receipt" | "return";
  description: string;
  debit: number;   // increases what customer owes us
  credit: number;  // reduces what customer owes us
};

export default async function CustomerStatementPage({ searchParams }: Params) {
  return loadErpPage("accounting.view", async ({ orgId, permissions }) => {
    const currency = await getBaseCurrencyCode(orgId);
    const sp = await searchParams;

    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fromDate = sp.from ? new Date(sp.from) : firstOfMonth;
    const toDate   = sp.to   ? new Date(sp.to)   : now;
    const fromISO  = fromDate.toISOString().slice(0, 10);
    const toISO    = toDate.toISOString().slice(0, 10);

    const custRows = await db
      .select({ id: customers.id, nameAr: customers.nameAr, balance: customers.balance })
      .from(customers)
      .where(eq(customers.organizationId, orgId))
      .orderBy(customers.nameAr);

    const selectedId = sp.customerId ?? "";
    const selectedCust = custRows.find((c) => c.id === selectedId);

    // Opening balance = everything before fromDate
    let openingBalance = 0;
    const txRows: TxRow[] = [];

    if (selectedId) {
      // Opening balance: sum of invoices − receipts − returns BEFORE the period
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
      openingBalance = Number(obResult.rows[0]?.balance ?? 0);

      // Sales invoices in period
      const invRows = await db
        .select({
          id: salesInvoices.id, number: salesInvoices.number, date: salesInvoices.date,
          totalAmount: salesInvoices.totalAmount, status: salesInvoices.status,
        })
        .from(salesInvoices)
        .where(and(
          eq(salesInvoices.organizationId, orgId),
          eq(salesInvoices.customerId, selectedId),
          sql`${salesInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
        ))
        .orderBy(asc(salesInvoices.date), asc(salesInvoices.number));

      for (const r of invRows) {
        txRows.push({
          date: r.date, number: r.number, type: "invoice",
          description: `فاتورة بيع ${r.number}`,
          debit: Number(r.totalAmount), credit: 0,
        });
      }

      // Receipts in period
      const recRows = await db
        .select({
          id: receiptVouchers.id, number: receiptVouchers.number, date: receiptVouchers.date,
          amount: receiptVouchers.amount, reference: receiptVouchers.reference,
        })
        .from(receiptVouchers)
        .where(and(
          eq(receiptVouchers.organizationId, orgId),
          eq(receiptVouchers.customerId, selectedId),
          eq(receiptVouchers.status, "POSTED"),
          gte(receiptVouchers.date, fromDate),
          lte(receiptVouchers.date, toDate),
        ))
        .orderBy(asc(receiptVouchers.date), asc(receiptVouchers.number));

      for (const r of recRows) {
        txRows.push({
          date: r.date, number: r.number, type: "receipt",
          description: `سند قبض ${r.number}${r.reference ? ` — ${r.reference}` : ""}`,
          debit: 0, credit: Number(r.amount),
        });
      }

      // Returns in period
      const retRows = await db
        .select({
          id: salesReturns.id, number: salesReturns.number, date: salesReturns.date,
          totalAmount: salesReturns.totalAmount,
        })
        .from(salesReturns)
        .where(and(
          eq(salesReturns.organizationId, orgId),
          eq(salesReturns.customerId, selectedId),
          eq(salesReturns.status, "CONFIRMED"),
          gte(salesReturns.date, fromDate),
          lte(salesReturns.date, toDate),
        ))
        .orderBy(asc(salesReturns.date), asc(salesReturns.number));

      for (const r of retRows) {
        txRows.push({
          date: r.date, number: r.number, type: "return",
          description: `مرتجع مبيعات ${r.number}`,
          debit: 0, credit: Number(r.totalAmount),
        });
      }

      // Sort all transactions by date then number
      txRows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));
    }

    // Build running balance
    let runBalance = openingBalance;
    const rows = txRows.map((t) => {
      runBalance = runBalance + t.debit - t.credit;
      return { ...t, balance: runBalance };
    });
    const closingBalance = runBalance;

    const typeBadge = (type: TxRow["type"]) => {
      if (type === "invoice") return <Badge variant="secondary">فاتورة</Badge>;
      if (type === "receipt") return <Badge variant="default" className="bg-emerald-600">قبض</Badge>;
      return <Badge variant="outline" className="border-amber-500 text-amber-600">مرتجع</Badge>;
    };


    return (
      <ReportShell
        reportKey="customer-statement"
        icon="ScrollText"
        title="كشف حساب العميل"
        subtitle="فواتير ومقبوضات ومرتجعات عميل خلال فترة"
        query={selectedId ? new URLSearchParams({ customerId: selectedId, from: fromISO, to: toISO }).toString() : ""}
        permissions={permissions}
        filters={
          <>
            <ReportField label="العميل">
              <FormCombobox name="customerId" defaultValue={selectedId} placeholder="ابحث…"
                options={custRows.map((c) => ({ id: c.id, label: c.nameAr }))} />
            </ReportField>
            <ReportField label="من تاريخ"><input name="from" type="date" defaultValue={fromISO} className={selectCls} /></ReportField>
            <ReportField label="إلى تاريخ"><input name="to" type="date" defaultValue={toISO} className={selectCls} /></ReportField>
          </>
        }
        kpis={selectedId ? [
          { label: "رصيد الافتتاح", value: money(openingBalance, currency), tone: "muted" as const },
          { op: "+" as const },
          { label: "إجمالي الفواتير", value: money(txRows.reduce((s, r) => s + r.debit, 0), currency) },
          { op: "−" as const },
          { label: "إجمالي المقبوضات", value: money(txRows.reduce((s, r) => s + r.credit, 0), currency), tone: "profit" as const },
          { op: "=" as const },
          { label: closingBalance >= 0 ? "الرصيد المستحق" : "رصيد زائد (دائن)",
            value: money(Math.abs(closingBalance), currency),
            tone: closingBalance > 0 ? "loss" as const : "profit" as const },
        ] : undefined}
      >
        {!selectedId ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
            اختر عميلًا لعرض كشف حسابه.
          </div>
        ) : (
          <>
            {/* Transactions table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  كشف حساب: {selectedCust?.nameAr}
                  <span className="ms-2 text-sm font-normal text-muted-foreground">
                    ({fromISO} → {toISO})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                    لا توجد حركات في هذه الفترة.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs text-muted-foreground">
                        <tr className="[&>th]:p-3 [&>th]:text-start">
                          <th>التاريخ</th>
                          <th>المستند</th>
                          <th>البيان</th>
                          <th>النوع</th>
                          <th className="text-end">مدين</th>
                          <th className="text-end">دائن</th>
                          <th className="text-end">الرصيد</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Opening balance row */}
                        <tr className="border-t bg-muted/10 font-medium [&>td]:p-3">
                          <td className="text-xs text-muted-foreground">{fromISO}</td>
                          <td>—</td>
                          <td>رصيد افتتاحي</td>
                          <td />
                          <td className="text-end tabular-nums">{openingBalance > 0 ? fmt(openingBalance) : "—"}</td>
                          <td className="text-end tabular-nums">{openingBalance < 0 ? fmt(-openingBalance) : "—"}</td>
                          <td className="text-end tabular-nums font-semibold">{fmt(openingBalance)}</td>
                        </tr>
                        {rows.map((r, i) => (
                          <tr key={i} className="border-t [&>td]:p-3">
                            <td className="text-xs text-muted-foreground">{dateStr(r.date)}</td>
                            <td className="font-mono text-xs">{r.number}</td>
                            <td>{r.description}</td>
                            <td>{typeBadge(r.type)}</td>
                            <td className="text-end tabular-nums text-blue-700 dark:text-blue-400">
                              {r.debit > 0 ? fmt(r.debit) : "—"}
                            </td>
                            <td className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">
                              {r.credit > 0 ? fmt(r.credit) : "—"}
                            </td>
                            <td className={`text-end tabular-nums font-medium ${r.balance > 0 ? "text-red-700 dark:text-red-400" : r.balance < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                              {fmt(r.balance)}
                            </td>
                          </tr>
                        ))}
                        {/* Closing balance row */}
                        <tr className="border-t-2 bg-muted/20 font-bold [&>td]:p-3">
                          <td colSpan={4}>الرصيد الختامي</td>
                          <td className="text-end tabular-nums">{fmt(txRows.reduce((s, r) => s + r.debit, 0))}</td>
                          <td className="text-end tabular-nums">{fmt(txRows.reduce((s, r) => s + r.credit, 0))}</td>
                          <td className={`text-end tabular-nums ${closingBalance > 0 ? "text-red-700 dark:text-red-400" : closingBalance < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                            {fmt(closingBalance)} {closingBalance > 0 ? "(مدين)" : closingBalance < 0 ? "(دائن)" : ""}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </ReportShell>
    );
  });
}
