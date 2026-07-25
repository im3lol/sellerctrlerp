import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items, stockMovements, salesReturns, salesReturnLines, platformItemFees } from "@/db/schema";
import { buildProfitability } from "@/lib/erp/profitability";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const pct = (n: number) => `${n.toFixed(1)}%`;

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];
// Outbound stock issues that represent a sale's cost of goods (DELIVERY for the
// order→delivery→invoice flow, SALES_INVOICE for standalone invoices); SALES_RETURN
// brings goods back (reverses COGS). Never double-counts: each sale issues stock once.
const SALE_REFS = ["DELIVERY", "SALES_INVOICE", "SALES_RETURN"];

export default async function ProfitabilityReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();
    const fromD = new Date(from), toD = new Date(to + "T23:59:59");

    const [revRows, cogsRows, returnRows, feeRows] = await Promise.all([
      db.select({
        itemId: salesInvoiceLines.itemId, code: items.code, name: items.nameAr,
        qty: sql<string>`sum(${salesInvoiceLines.quantity})`,
        // Net of VAT — VAT is pass-through, not margin.
        revenue: sql<string>`sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount})`,
      })
        .from(salesInvoiceLines)
        .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
        .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, fromD), lte(salesInvoices.date, toD)))
        .groupBy(salesInvoiceLines.itemId, items.code, items.nameAr),
      db.select({
        itemId: stockMovements.itemId,
        cogs: sql<string>`sum(case when ${stockMovements.type} = 'OUT' then ${stockMovements.totalCost} else -${stockMovements.totalCost} end)`,
      })
        .from(stockMovements)
        .where(and(eq(stockMovements.organizationId, orgId), inArray(stockMovements.referenceType, SALE_REFS), gte(stockMovements.date, fromD), lte(stockMovements.date, toD)))
        .groupBy(stockMovements.itemId),
      // Money (invoice) returns reduce revenue; deliveryNoteId IS NULL = money return.
      // totalAmount on a return line is quantity×unitPrice (net of VAT).
      db.select({
        itemId: salesReturnLines.itemId,
        revenue: sql<string>`sum(${salesReturnLines.totalAmount})`,
      })
        .from(salesReturnLines)
        .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
        .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.status, "POSTED"), isNull(salesReturns.deliveryNoteId), gte(salesReturns.date, fromD), lte(salesReturns.date, toD)))
        .groupBy(salesReturnLines.itemId),
      // Estimated per-unit marketplace fees (referral + FBA) — optional overlay.
      db.select({ itemId: platformItemFees.itemId, totalFees: platformItemFees.totalFees })
        .from(platformItemFees).where(eq(platformItemFees.organizationId, orgId)),
    ]);

    const cogsByItem = new Map(cogsRows.map((r) => [r.itemId, Number(r.cogs ?? 0)]));
    const returnsByItem = new Map(returnRows.map((r) => [r.itemId, Number(r.revenue ?? 0)]));
    const feesByItem = new Map(feeRows.map((r) => [r.itemId, Number(r.totalFees ?? 0)]));
    let list = buildProfitability(
      revRows.map((r) => ({ itemId: r.itemId, code: r.code, name: r.name, qty: Number(r.qty ?? 0), revenue: Number(r.revenue ?? 0) })),
      returnsByItem, cogsByItem, feesByItem,
    );
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.profit - a.profit);

    const tRevenue = list.reduce((s, r) => s + r.revenue, 0);
    const tCogs = list.reduce((s, r) => s + r.cogs, 0);
    const tProfit = tRevenue - tCogs;
    const tMargin = tRevenue > 0 ? (tProfit / tRevenue) * 100 : 0;
    const tFees = list.reduce((s, r) => s + r.fees, 0);
    const tNet = tProfit - tFees;
    const hasFees = tFees > 0;

    const qs = new URLSearchParams({ from, to });
    if (search) qs.set("q", search);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="TrendingUp" title="ربحية المنتجات" subtitle="الإيراد والتكلفة والربح الإجمالي لكل صنف" action={<ReportToolbar excel={list.length > 0 ? `/api/erp/sales/profitability/export?${qs.toString()}` : undefined} printHref={`/erp/sales/reports/profitability/print?${qs.toString()}`} />} />
        <ItemSalesFilters from={from} to={to} q={search} />

        <div className={`grid gap-4 ${hasFees ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4"}`}>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">صافي الإيراد (بدون ضريبة)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(tRevenue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">تكلفة البضاعة المباعة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(tCogs)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">الربح الإجمالي</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${tProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(tProfit)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">هامش الربح</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{pct(tMargin)}</p></CardContent></Card>
          {hasFees && <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">رسوم أمازون المقدرة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-muted-foreground">{fmt(tFees)}</p></CardContent></Card>}
          {hasFees && <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">صافي الربح بعد الرسوم</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${tNet >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(tNet)}</p></CardContent></Card>}
        </div>

        {list.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>أعلى الأصناف ربحًا</CardTitle>
              <CardDescription>أعلى ٨ أصناف حسب الربح.</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart data={list.slice(0, 8).map((r) => ({ label: r.name ?? r.code ?? "—", value: r.profit }))} valueLabel="الربح" money height={240} colors={list.slice(0, 8).map((r) => (r.profit >= 0 ? "#008300" : "#e34948"))} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>الربحية حسب الصنف</CardTitle>
            <CardDescription>الفترة {from} إلى {to} — التكلفة من إذون الصرف/الفواتير المرحّلة (قد تختلف توقيتاً عن الإيراد في دورة التسليم-ثم-الفوترة).</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">#</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-end">الكمية</TableHead>
                    <TableHead className="text-end">صافي الإيراد</TableHead>
                    <TableHead className="text-end">التكلفة</TableHead>
                    <TableHead className="text-end">الربح</TableHead>
                    <TableHead className="text-end">الهامش</TableHead>
                    {hasFees && <TableHead className="text-end">رسوم أمازون</TableHead>}
                    {hasFees && <TableHead className="text-end">الصافي بعد الرسوم</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((r, i) => (
                    <TableRow key={r.code ?? i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal"><div className="line-clamp-2 leading-snug" title={r.name ?? undefined}><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</div></TableCell>
                      <TableCell className="text-end tabular-nums">{qtyf(r.qty)}</TableCell>
                      <TableCell className="text-end tabular-nums">{fmt(r.revenue)}</TableCell>
                      <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(r.cogs)}</TableCell>
                      <TableCell className={`text-end tabular-nums font-medium ${r.profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(r.profit)}</TableCell>
                      <TableCell className="text-end tabular-nums">{pct(r.margin)}</TableCell>
                      {hasFees && <TableCell className="text-end tabular-nums text-muted-foreground">{r.fees > 0 ? fmt(r.fees) : "—"}</TableCell>}
                      {hasFees && <TableCell className={`text-end tabular-nums font-medium ${r.netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{r.fees > 0 ? fmt(r.netProfit) : "—"}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
