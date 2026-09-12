import Link from "next/link";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell } from "@/components/erp/report-shell";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: unknown) => (d ? new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

export default async function SupplierRankingPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;
    const from = one(sp.from) || (await orgFiscalYearStartISO(orgId));
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();

    const rows = await db.select({
      id: suppliers.id, code: suppliers.code, name: suppliers.nameAr, balance: suppliers.balance,
      invoices: sql<number>`count(${purchaseInvoices.id})`,
      spend: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount}), 0)`,
      last: sql<string>`max(${purchaseInvoices.date})`,
    })
      .from(suppliers)
      .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.supplierId, suppliers.id), inArray(purchaseInvoices.status, POSTED), gte(purchaseInvoices.date, new Date(from)), lte(purchaseInvoices.date, new Date(to + "T23:59:59"))))
      .where(eq(suppliers.organizationId, orgId))
      .groupBy(suppliers.id, suppliers.code, suppliers.nameAr, suppliers.balance);

    let list = rows.map((r) => ({ id: r.id, code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), spend: Number(r.spend), last: r.last }));
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name?.toLowerCase().includes(search));
    list.sort((a, b) => b.spend - a.spend);

    const tSpend = list.reduce((s, r) => s + r.spend, 0);
    const tAp = list.reduce((s, r) => s + r.balance, 0);

    const qsStr = new URLSearchParams({ from, to, ...(search ? { q: search } : {}) }).toString();

    return (
      <ReportShell
        reportKey="purch-suppliers"
        icon="Users"
        title="ترتيب الموردين"
        subtitle="أعلى الموردين بالمشتريات مع الرصيد المستحق وآخر تعامل"
        query={qsStr}
        permissions={permissions}
        filtersRaw={<ItemSalesFilters from={from} to={to} q={search} />}
        kpis={[
          { label: "موردون لديهم مشتريات", value: String(list.length), tone: "muted" },
          { label: "إجمالي المشتريات", value: fmt(tSpend), hint: "بدون ضريبة" },
          { label: "الذمم المستحقة للموردين", value: fmt(tAp), hint: "الرصيد الحالي" },
        ]}
        chartTitle={list.length > 0 ? "أعلى ٨ موردين مشتريات" : undefined}
        chart={list.length > 0
          ? <BarChart data={list.slice(0, 8).map((r) => ({ label: r.name, value: r.spend }))} valueLabel="المشتريات" money height={240} />
          : undefined}
      >
        <Card>
          <CardHeader>
            <CardTitle>الموردون حسب المشتريات</CardTitle>
            <CardDescription>الفترة {from} إلى {to} — المشتريات صافٍ من الضريبة؛ الرصيد المستحق هو الرصيد الحالي.</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد مشتريات في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-start">#</TableHead>
                  <TableHead className="text-start">المورد</TableHead>
                  <TableHead className="text-end">المشتريات</TableHead>
                  <TableHead className="text-end">الفواتير</TableHead>
                  <TableHead className="text-end">الرصيد المستحق</TableHead>
                  <TableHead className="text-end">آخر فاتورة</TableHead>
                  <TableHead className="text-end">% من الإجمالي</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map((r, i) => {
                    const pct = tSpend > 0 ? (r.spend / tSpend) * 100 : 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="max-w-[280px] whitespace-normal"><Link href={`/purchases/reports/ledger?supplier=${r.id}`} className="hover:text-primary"><span className="line-clamp-2 leading-snug" title={r.name ?? undefined}><span className="font-mono text-xs text-muted-foreground">{r.code}</span> {r.name}</span></Link></TableCell>
                        <TableCell className="text-end tabular-nums font-medium">{fmt(r.spend)}</TableCell>
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
      </ReportShell>
    );
  });
}
