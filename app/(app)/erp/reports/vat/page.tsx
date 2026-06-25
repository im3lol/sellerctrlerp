import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Params = { searchParams: Promise<{ from?: string; to?: string }> };

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── Summary box ─────────────────────────────────────────── */
function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" | "blue" }) {
  const colorCls = accent === "green"
    ? "text-emerald-600 dark:text-emerald-400"
    : accent === "red"
    ? "text-red-600 dark:text-red-400"
    : accent === "blue"
    ? "text-blue-600 dark:text-blue-400"
    : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colorCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

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
  const { orgId } = await requireErpModule("reports.view");
  const sp = await searchParams;

  // Default: current quarter
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const quarterEnd   = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
  const fromDate = sp.from ? new Date(sp.from) : quarterStart;
  const toDate   = sp.to   ? new Date(sp.to)   : quarterEnd;
  const fromISO  = fromDate.toISOString().slice(0, 10);
  const toISO    = toDate.toISOString().slice(0, 10);

  // Only POSTED/CONFIRMED invoices count as VAT obligations
  const ACTIVE = ["CONFIRMED", "POSTED", "PARTIALLY_PAID", "PAID"];

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
        sql`${salesInvoices.status} = ANY(ARRAY[${sql.raw(ACTIVE.map((s) => `'${s}'`).join(","))}])`,
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
        sql`${purchaseInvoices.status} = ANY(ARRAY[${sql.raw(ACTIVE.map((s) => `'${s}'`).join(","))}])`,
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

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Percent"
        title="تقرير ضريبة القيمة المضافة"
        subtitle="ملخّص الضريبة المحصّلة على المبيعات والضريبة المدفوعة على المشتريات"
      />
      <ReportTabs active="/erp/reports/vat" />

      {/* Date filter */}
      <form method="GET" className="flex flex-wrap items-end gap-3">
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

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="الضريبة المحصّلة (مخرجات)"  value={`${fmt(outputVat)} ﷼`}  sub={`على مبيعات ${fmt(outputBase)} ﷼`}  accent="green" />
        <Tile label="الضريبة المدفوعة (مدخلات)"  value={`${fmt(inputVat)} ﷼`}   sub={`على مشتريات ${fmt(inputBase)} ﷼`} accent="blue"  />
        <Tile
          label={netVat >= 0 ? "صافي الضريبة المستحقة" : "ضريبة مستردّة"}
          value={`${fmt(Math.abs(netVat))} ﷼`}
          sub={netVat >= 0 ? "مستحق للهيئة" : "قابل للاسترداد"}
          accent={netVat >= 0 ? "red" : "green"}
        />
        <Tile label="عدد الفواتير الخاضعة"
          value={String(salesLines.length + purchaseLines.length)}
          sub={`${salesLines.length} مبيعات · ${purchaseLines.length} مشتريات`} />
      </div>

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
                    <td className={`text-end tabular-nums ${row.cls}`}>{fmt(row.val)} ﷼</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-muted/30 font-bold [&>td]:p-3">
                  <td className={netVat >= 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
                    {netVat >= 0 ? "صافي الضريبة المستحقة للهيئة" : "ضريبة مستردّة من الهيئة"}
                  </td>
                  <td className={`text-end tabular-nums ${netVat >= 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {fmt(Math.abs(netVat))} ﷼
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
    </div>
  );
}
