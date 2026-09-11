import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
// money() carries the single currency-symbol map — the same one the printed
// documents use — so a تقرير ضريبة can't print a currency the invoices don't.
import { money } from "@/lib/erp/print-format";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Params = { searchParams: Promise<{ from?: string; to?: string }> };

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── Summary box ─────────────────────────────────────────── */

/* ── VAT lines table ─────────────────────────────────────── */
type VatLine = { number: string; date: Date; counterparty: string; netAmount: number; taxAmount: number; taxRate: number };

function VatTable({ lines, emptyText }: { lines: VatLine[]; emptyText: string }) {
  if (lines.length === 0) {
    return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{emptyText}</div>;
  }
  const total = { net: lines.reduce((s, l) => s + l.netAmount, 0), tax: lines.reduce((s, l) => s + l.taxAmount, 0) };
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs text-muted-foreground">
          <tr className="[&>th]:p-3 [&>th]:text-start">
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>الطرف</th>
            <th className="text-end">صافي المبلغ</th>
            <th className="text-end">نسبة الضريبة</th>
            <th className="text-end">مبلغ الضريبة</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.number} className="border-t [&>td]:p-3">
              <td className="font-mono text-xs">{l.number}</td>
              <td className="text-xs text-muted-foreground">{new Date(l.date).toLocaleDateString("ar-EG")}</td>
              <td>{l.counterparty}</td>
              <td className="text-end tabular-nums">{fmt(l.netAmount)}</td>
              <td className="text-end tabular-nums text-muted-foreground">{l.taxRate > 0 ? `${l.taxRate}%` : "—"}</td>
              <td className="text-end tabular-nums font-medium">{fmt(l.taxAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/20 font-semibold">
          <tr className="[&>td]:p-3">
            <td colSpan={3}>الإجمالي</td>
            <td className="text-end tabular-nums">{fmt(total.net)}</td>
            <td />
            <td className="text-end tabular-nums">{fmt(total.tax)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────── */
export default async function VatReportPage({ searchParams }: Params) {
  return loadErpPage("reports.view", async ({ orgId, permissions }) => {
    const currency = await getBaseCurrencyCode(orgId);
    const sp = await searchParams;

    // Default: current quarter
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const quarterEnd   = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
    // Guard against a malformed ?from=/?to= URL param (Invalid Date → .toISOString() throws).
    const okDate = (s: string | undefined, fallback: Date) => {
      if (!s) return fallback;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const fromDate = okDate(sp.from, quarterStart);
    const toDate   = okDate(sp.to, quarterEnd);
    const fromISO  = fromDate.toISOString().slice(0, 10);
    const toISO    = toDate.toISOString().slice(0, 10);

    // Every live invoice carries its VAT obligation regardless of whether it has been
    // paid. This used to enumerate the statuses by hand and misspelled one of them
    // ('PARTIALLY_PAID' — the real status is PARTIAL_PAID), so every partially-paid
    // invoice was dropped from the return and output VAT was under-declared.
    /* ── Output VAT (sales) ─────────────────────────────────── */
    const salesRows = await db
      .select({
        number:  salesInvoices.number,
        date:    salesInvoices.date,
        nameAr:  sql<string>`(SELECT name_ar FROM customers WHERE id = ${salesInvoices.customerId})`,
        net:     sql<string>`(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount})`,
        tax:     salesInvoices.taxAmount,
        taxPct:  salesInvoices.taxPercent,
      })
      .from(salesInvoices)
      .where(
        and(
          eq(salesInvoices.organizationId, orgId),
          liveInvoice(salesInvoices.status),
          gte(salesInvoices.date, fromDate),
          lte(salesInvoices.date, toDate),
          ne(salesInvoices.taxAmount, "0"),
        ),
      )
      .orderBy(salesInvoices.date, salesInvoices.number);

    /* ── Input VAT (purchases) ──────────────────────────────── */
    const purchaseRows = await db
      .select({
        number: purchaseInvoices.number,
        date:   purchaseInvoices.date,
        nameAr: sql<string>`(SELECT name_ar FROM suppliers WHERE id = ${purchaseInvoices.supplierId})`,
        net:    sql<string>`(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount} - COALESCE(${purchaseInvoices.shippingAmount}, 0))`,
        tax:    purchaseInvoices.taxAmount,
        taxPct: purchaseInvoices.taxPercent,
      })
      .from(purchaseInvoices)
      .where(
        and(
          eq(purchaseInvoices.organizationId, orgId),
          liveInvoice(purchaseInvoices.status),
          gte(purchaseInvoices.date, fromDate),
          lte(purchaseInvoices.date, toDate),
          ne(purchaseInvoices.taxAmount, "0"),
        ),
      )
      .orderBy(purchaseInvoices.date, purchaseInvoices.number);

    const salesLines: VatLine[] = salesRows.map((r) => ({
      number: r.number,
      date: r.date,
      counterparty: r.nameAr ?? "—",
      netAmount: Number(r.net),
      taxAmount: Number(r.tax),
      taxRate: Number(r.taxPct),
    }));

    const purchaseLines: VatLine[] = purchaseRows.map((r) => ({
      number: r.number,
      date: r.date,
      counterparty: r.nameAr ?? "—",
      netAmount: Number(r.net),
      taxAmount: Number(r.tax),
      taxRate: Number(r.taxPct),
    }));

    const outputVat  = salesLines.reduce((s, l) => s + l.taxAmount, 0);
    const inputVat   = purchaseLines.reduce((s, l) => s + l.taxAmount, 0);
    const netVat     = outputVat - inputVat;
    const outputBase = salesLines.reduce((s, l) => s + l.netAmount, 0);
    const inputBase  = purchaseLines.reduce((s, l) => s + l.netAmount, 0);

    const query = new URLSearchParams({ from: fromISO, to: toISO }).toString();
    const inp = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";

    return (
      <ReportShell
        reportKey="vat"
        icon="Percent"
        title="تقرير ضريبة القيمة المضافة"
        subtitle={`من ${fromISO} إلى ${toISO} — المحصّلة على المبيعات والمدفوعة على المشتريات`}
        query={query}
        permissions={permissions}
        filters={
          <>
            <ReportField label="من تاريخ"><input name="from" type="date" defaultValue={fromISO} className={inp} /></ReportField>
            <ReportField label="إلى تاريخ"><input name="to" type="date" defaultValue={toISO} className={inp} /></ReportField>
          </>
        }
        kpis={[
          { label: "المحصّلة (مخرجات)", value: money(outputVat, currency), hint: `على مبيعات ${money(outputBase, currency)}` },
          { op: "−" },
          { label: "المدفوعة (مدخلات)", value: money(inputVat, currency), hint: `على مشتريات ${money(inputBase, currency)}` },
          { op: "=" },
          { label: netVat >= 0 ? "المستحقة للهيئة" : "القابلة للاسترداد",
            value: money(Math.abs(netVat), currency),
            tone: netVat >= 0 ? "loss" : "profit",
            hint: `${salesLines.length + purchaseLines.length} فاتورة خاضعة` },
        ]}
      >
        {/* VAT return box */}
        <Card>
          <CardHeader><CardTitle className="text-base">ملخّص الإقرار الضريبي</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { label: "إجمالي المبيعات الخاضعة للضريبة", val: outputBase, cls: "" },
                    { label: "ضريبة القيمة المضافة المحصّلة (مخرجات)", val: outputVat, cls: "font-medium text-emerald-700 dark:text-emerald-400" },
                    { label: "إجمالي المشتريات الخاضعة للضريبة", val: inputBase, cls: "" },
                    { label: "ضريبة القيمة المضافة المدفوعة (مدخلات)", val: inputVat, cls: "font-medium text-blue-700 dark:text-blue-400" },
                  ].map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0 [&>td]:p-3">
                      <td className={row.cls}>{row.label}</td>
                      <td className={`text-end tabular-nums ${row.cls}`}>{money(row.val, currency)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-muted/30 font-bold [&>td]:p-3">
                    <td className={netVat >= 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                      {netVat >= 0 ? "صافي الضريبة المستحقة للهيئة" : "ضريبة مستردّة من الهيئة"}
                    </td>
                    <td className={`text-end tabular-nums ${netVat >= 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {money(Math.abs(netVat), currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Detail tables */}
        <div className="space-y-2">
          <h3 className="font-semibold">تفاصيل الضريبة المحصّلة (فواتير البيع)</h3>
          <VatTable lines={salesLines} emptyText="لا توجد فواتير بيع خاضعة للضريبة في هذه الفترة" />
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">تفاصيل الضريبة المدفوعة (فواتير الشراء)</h3>
          <VatTable lines={purchaseLines} emptyText="لا توجد فواتير شراء خاضعة للضريبة في هذه الفترة" />
        </div>
      </ReportShell>
    );
  });
}
