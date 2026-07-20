import Link from "next/link";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportToolbar } from "@/components/erp/report-toolbar";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function CustomerRankingPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const rows = await db.select({
      id: customers.id, code: customers.code, name: customers.nameAr, balance: customers.balance,
      invoices: sql<number>`count(${salesInvoices.id})`,
      revenue: sql<string>`coalesce(sum(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount}), 0)`,
      last: sql<string>`max(${salesInvoices.date})`,
    })
      .from(customers)
      .innerJoin(salesInvoices, and(eq(salesInvoices.customerId, customers.id), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, new Date(from)), lte(salesInvoices.date, new Date(to + "T23:59:59"))))
      .where(eq(customers.organizationId, orgId))
      .groupBy(customers.id, customers.code, customers.nameAr, customers.balance);

    let list = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), revenue: Number(r.revenue), last: r.last }));
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.revenue - a.revenue);

    const tRevenue = list.reduce((s, r) => s + r.revenue, 0);
    const tAr = list.reduce((s, r) => s + r.balance, 0);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Users" title="ترتيب العملاء" subtitle="أفضل العملاء بالإيراد مع الرصيد المستحق وآخر تعامل" action={<ReportToolbar />} />
        <ItemSalesFilters from={from} to={to} q={search} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">عملاء لديهم مبيعات</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{list.length}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الإيراد (بدون ضريبة)</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-emerald-600">{fmt(tRevenue)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الذمم المستحقة</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums">{fmt(tAr)}</p></CardContent></Card>
        </div>

        {list.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>أعلى العملاء إيرادًا</CardTitle>
              <CardDescription>أعلى ٨ عملاء حسب الإيراد.</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart data={list.slice(0, 8).map((r) => ({ label: r.name, value: r.revenue }))} valueLabel="الإيراد" money height={240} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>العملاء حسب الإيراد</CardTitle>
            <CardDescription>الفترة {from} إلى {to} — الإيراد صافٍ من الضريبة؛ الرصيد المستحق هو الرصيد الحالي.</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مبيعات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-start">#</TableHead>
                  <TableHead className="text-start">العميل</TableHead>
                  <TableHead className="text-end">الإيراد</TableHead>
                  <TableHead className="text-end">الفواتير</TableHead>
                  <TableHead className="text-end">الرصيد المستحق</TableHead>
                  <TableHead className="text-end">آخر فاتورة</TableHead>
                  <TableHead className="text-end">% من الإجمالي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map((r, i) => {
                    const pct = tRevenue > 0 ? (r.revenue / tRevenue) * 100 : 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell><Link href={`/accounting/customer-statement?customer=${r.id}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</Link></TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{fmt(r.revenue)}</TableCell>
                        <TableCell className="text-end tabular-nums">{r.invoices}</TableCell>
                        <TableCell className={`text-end tabular-nums ${r.balance > 0 ? "text-amber-600" : ""}`}>{fmt(r.balance)}</TableCell>
                        <TableCell className="text-end tabular-nums text-muted-foreground">{dt(r.last)}</TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-2 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct.toFixed(1)}%` }} /></div>
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
  });
}
