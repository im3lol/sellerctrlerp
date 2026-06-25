import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers, purchaseInvoices, paymentVouchers, purchaseReturns } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Params = { searchParams: Promise<{ supplierId?: string; from?: string; to?: string }> };

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateStr = (d: Date) => new Date(d).toLocaleDateString("ar-EG");

type TxRow = {
  date: Date;
  number: string;
  type: "invoice" | "payment" | "return";
  description: string;
  debit: number;   // payment reduces what we owe
  credit: number;  // invoice increases what we owe
};

export default async function SupplierStatementPage({ searchParams }: Params) {
  const { orgId } = await requireErpModule("accounting.view");
  const sp = await searchParams;

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const fromDate = sp.from ? new Date(sp.from) : firstOfMonth;
  const toDate   = sp.to   ? new Date(sp.to)   : now;
  const fromISO  = fromDate.toISOString().slice(0, 10);
  const toISO    = toDate.toISOString().slice(0, 10);

  const supplierRows = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, balance: suppliers.balance })
    .from(suppliers)
    .where(eq(suppliers.organizationId, orgId))
    .orderBy(suppliers.nameAr);

  const selectedId = sp.supplierId ?? "";
  const selectedSupp = supplierRows.find((s) => s.id === selectedId);

  let openingBalance = 0;
  const txRows: TxRow[] = [];

  if (selectedId) {
    // Opening balance: sum of invoices − payments − returns BEFORE the period
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
    openingBalance = Number(obResult.rows[0]?.balance ?? 0);

    // Purchase invoices in period
    const invRows = await db
      .select({
        id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date,
        totalAmount: purchaseInvoices.totalAmount, status: purchaseInvoices.status,
      })
      .from(purchaseInvoices)
      .where(and(
        eq(purchaseInvoices.organizationId, orgId),
        eq(purchaseInvoices.supplierId, selectedId),
        sql`${purchaseInvoices.status} NOT IN ('DRAFT','CANCELLED')`,
        gte(purchaseInvoices.date, fromDate),
        lte(purchaseInvoices.date, toDate),
      ))
      .orderBy(asc(purchaseInvoices.date), asc(purchaseInvoices.number));

    for (const r of invRows) {
      txRows.push({
        date: r.date, number: r.number, type: "invoice",
        description: `فاتورة شراء ${r.number}`,
        debit: 0, credit: Number(r.totalAmount),
      });
    }

    // Payments in period
    const payRows = await db
      .select({
        id: paymentVouchers.id, number: paymentVouchers.number, date: paymentVouchers.date,
        amount: paymentVouchers.amount, reference: paymentVouchers.reference,
      })
      .from(paymentVouchers)
      .where(and(
        eq(paymentVouchers.organizationId, orgId),
        eq(paymentVouchers.supplierId, selectedId),
        eq(paymentVouchers.status, "POSTED"),
        gte(paymentVouchers.date, fromDate),
        lte(paymentVouchers.date, toDate),
      ))
      .orderBy(asc(paymentVouchers.date), asc(paymentVouchers.number));

    for (const r of payRows) {
      txRows.push({
        date: r.date, number: r.number, type: "payment",
        description: `سند دفع ${r.number}${r.reference ? ` — ${r.reference}` : ""}`,
        debit: Number(r.amount), credit: 0,
      });
    }

    // Returns in period
    const retRows = await db
      .select({
        id: purchaseReturns.id, number: purchaseReturns.number, date: purchaseReturns.date,
        totalAmount: purchaseReturns.totalAmount,
      })
      .from(purchaseReturns)
      .where(and(
        eq(purchaseReturns.organizationId, orgId),
        eq(purchaseReturns.supplierId, selectedId),
        eq(purchaseReturns.status, "CONFIRMED"),
        gte(purchaseReturns.date, fromDate),
        lte(purchaseReturns.date, toDate),
      ))
      .orderBy(asc(purchaseReturns.date), asc(purchaseReturns.number));

    for (const r of retRows) {
      txRows.push({
        date: r.date, number: r.number, type: "return",
        description: `مرتجع مشتريات ${r.number}`,
        debit: Number(r.totalAmount), credit: 0,
      });
    }

    txRows.sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));
  }

  let runBalance = openingBalance;
  const rows = txRows.map((t) => {
    runBalance = runBalance + t.credit - t.debit;
    return { ...t, balance: runBalance };
  });
  const closingBalance = runBalance;

  const typeBadge = (type: TxRow["type"]) => {
    if (type === "invoice") return <Badge variant="secondary">فاتورة</Badge>;
    if (type === "payment") return <Badge variant="default" className="bg-emerald-600">دفع</Badge>;
    return <Badge variant="outline" className="border-amber-500 text-amber-600">مرتجع</Badge>;
  };

  const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="ScrollText"
        title="كشف حساب المورّد"
        subtitle="عرض كل المعاملات (فواتير · مدفوعات · مرتجعات) لمورّد محدد خلال فترة"
        backHref="/erp/accounting"
      />

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 min-w-48">
          <label className="text-xs text-muted-foreground">المورّد</label>
          <select name="supplierId" defaultValue={selectedId} className={selectCls}>
            <option value="">— اختر مورّدًا —</option>
            {supplierRows.map((s) => (
              <option key={s.id} value={s.id}>{s.nameAr}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">من</label>
          <input name="from" type="date" defaultValue={fromISO}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">إلى</label>
          <input name="to" type="date" defaultValue={toISO}
            className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm" />
        </div>
        <button type="submit"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90">
          عرض
        </button>
      </form>

      {!selectedId ? (
        <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
          اختر مورّدًا لعرض كشف حسابه.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "رصيد الافتتاح",      value: fmt(openingBalance),  cls: "" },
              { label: "إجمالي الفواتير",    value: fmt(txRows.reduce((s, r) => s + r.credit, 0)), cls: "text-red-600 dark:text-red-400" },
              { label: "إجمالي المدفوعات",   value: fmt(txRows.reduce((s, r) => s + r.debit, 0)),  cls: "text-emerald-600 dark:text-emerald-400" },
              {
                label: closingBalance >= 0 ? "الرصيد الدائن (مستحق)" : "رصيد زائد (دفعنا زيادة)",
                value: fmt(Math.abs(closingBalance)),
                cls: closingBalance > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400",
              },
            ].map((t, i) => (
              <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className={`mt-1 text-xl font-bold tabular-nums ${t.cls}`}>{t.value} ﷼</p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                كشف حساب: {selectedSupp?.nameAr}
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
                      <tr className="border-t bg-muted/10 font-medium [&>td]:p-3">
                        <td className="text-xs text-muted-foreground">{fromISO}</td>
                        <td>—</td>
                        <td>رصيد افتتاحي</td>
                        <td />
                        <td className="text-end tabular-nums">{openingBalance < 0 ? fmt(-openingBalance) : "—"}</td>
                        <td className="text-end tabular-nums">{openingBalance > 0 ? fmt(openingBalance) : "—"}</td>
                        <td className="text-end tabular-nums font-semibold">{fmt(openingBalance)}</td>
                      </tr>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t [&>td]:p-3">
                          <td className="text-xs text-muted-foreground">{dateStr(r.date)}</td>
                          <td className="font-mono text-xs">{r.number}</td>
                          <td>{r.description}</td>
                          <td>{typeBadge(r.type)}</td>
                          <td className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">
                            {r.debit > 0 ? fmt(r.debit) : "—"}
                          </td>
                          <td className="text-end tabular-nums text-red-700 dark:text-red-400">
                            {r.credit > 0 ? fmt(r.credit) : "—"}
                          </td>
                          <td className={`text-end tabular-nums font-medium ${r.balance > 0 ? "text-red-700 dark:text-red-400" : r.balance < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                            {fmt(r.balance)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 bg-muted/20 font-bold [&>td]:p-3">
                        <td colSpan={4}>الرصيد الختامي</td>
                        <td className="text-end tabular-nums">{fmt(txRows.reduce((s, r) => s + r.debit, 0))}</td>
                        <td className="text-end tabular-nums">{fmt(txRows.reduce((s, r) => s + r.credit, 0))}</td>
                        <td className={`text-end tabular-nums ${closingBalance > 0 ? "text-red-700 dark:text-red-400" : closingBalance < 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
                          {fmt(closingBalance)} {closingBalance > 0 ? "(دائن)" : closingBalance < 0 ? "(مدين)" : ""}
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
    </div>
  );
}
