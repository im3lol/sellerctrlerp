import { and, between, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (v: unknown) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function ItemSalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { orgId } = await requireErpModule("sales.view");
  const sp = await searchParams;

  const from = one(sp.from) || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
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

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BarChart3"
        title="تقرير مبيعات الأصناف"
        subtitle="إجمالي المبيعات مجمّعاً لكل صنف"
      />

      <ItemSalesFilters from={from} to={to} q={search} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الإيراد</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums">{fmt(totalRevenue)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الكميات</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums">{qtyf(totalQty)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">عدد الأصناف</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums">{filtered.length}</p></CardContent>
        </Card>
      </div>

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
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span>{" "}
                        {r.name}
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
    </div>
  );
}
