import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items } from "@/db/schema";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell } from "@/components/erp/report-shell";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function ItemSalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;

    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to   = one(sp.to)   || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const conditions = [
      eq(salesInvoices.organizationId, orgId),
      inArray(salesInvoices.status, POSTED),
      gte(salesInvoices.date, new Date(from)),
      lte(salesInvoices.date, new Date(to + "T23:59:59")),
    ];

    const rows = await db
      .select({
        code:         items.code,
        name:         items.nameAr,
        totalQty:     sql<string>`sum(${salesInvoiceLines.quantity})`,
        totalRevenue: sql<string>`sum(${salesInvoiceLines.totalAmount})`,
        totalTax:     sql<string>`sum(${salesInvoiceLines.taxAmount})`,
        avgPrice:     sql<string>`avg(${salesInvoiceLines.unitPrice})`,
        txnCount:     sql<string>`count(distinct ${salesInvoices.id})`,
      })
      .from(salesInvoiceLines)
      .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
      .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
      .where(and(...conditions))
      .groupBy(items.id, items.code, items.nameAr)
      .orderBy(desc(sql`sum(${salesInvoiceLines.totalAmount})`));

    const filtered = search
      ? rows.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search))
      : rows;

    const totalRevenue = filtered.reduce((s, r) => s + Number(r.totalRevenue ?? 0), 0);
    const totalQty     = filtered.reduce((s, r) => s + Number(r.totalQty ?? 0), 0);

    const qs = new URLSearchParams({ from, to });
    if (search) qs.set("q", search);

    return (
      <ReportShell
        reportKey="sales-items"
        icon="BarChart3"
        title="تقرير مبيعات الأصناف"
        subtitle="إجمالي المبيعات مجمّعاً لكل صنف"
        query={qs.toString()}
        permissions={permissions}
        filtersRaw={<ItemSalesFilters from={from} to={to} q={search} />}
        kpis={[
          { label: "إجمالي الإيراد", value: fmt(totalRevenue) },
          { label: "إجمالي الكميات", value: qtyf(totalQty), tone: "muted" },
          { label: "عدد الأصناف", value: String(filtered.length), tone: "muted" },
        ]}
        chartTitle={filtered.length > 0 ? "أعلى ٨ أصناف إيرادًا" : undefined}
        chart={filtered.length > 0
          ? <BarChart data={filtered.slice(0, 8).map((r) => ({ label: r.name ?? r.code ?? "—", value: Number(r.totalRevenue ?? 0) }))} valueLabel="الإيراد" money height={240} />
          : undefined}
      >
        <Card>
          <CardHeader>
            <CardTitle>تفصيل الأصناف</CardTitle>
            <CardDescription>مرتّب تنازلياً حسب الإيراد — الفترة: {from} إلى {to}</CardDescription>
          </CardHeader>
          <CardContent>
            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">#</TableHead>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-end">الكمية المباعة</TableHead>
                    <TableHead className="text-end">متوسط السعر</TableHead>
                    <TableHead className="text-end">الإيراد</TableHead>
                    <TableHead className="text-end">الضريبة</TableHead>
                    <TableHead className="text-end">عدد الفواتير</TableHead>
                    <TableHead className="text-end">% من الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, i) => {
                    const pct = totalRevenue > 0 ? (Number(r.totalRevenue) / totalRevenue) * 100 : 0;
                    return (
                      <TableRow key={r.code ?? i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal">
                          <div className="line-clamp-2 leading-snug" title={r.name ?? undefined}>
                            <span className="font-mono text-xs text-muted-foreground">{r.code}</span>{" "}
                            {r.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">{qtyf(r.totalQty)}</TableCell>
                        <TableCell className="text-end tabular-nums">{fmt(r.avgPrice)}</TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{fmt(r.totalRevenue)}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{fmt(r.totalTax)}</TableCell>
                        <TableCell className="text-end tabular-nums">{r.txnCount}</TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${pct.toFixed(1)}%` }} />
                            </div>
                            <span className="tabular-nums text-xs">{pct.toFixed(1)}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </ReportShell>
    );
  });
}
