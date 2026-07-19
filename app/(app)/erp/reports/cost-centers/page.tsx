import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntryLines, journalEntries, accounts, costCenters } from "@/db/schema";
import { GroupedBarChart } from "@/components/charts/grouped-bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ItemSalesFilters } from "@/components/erp/item-sales-filters";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => `${n.toFixed(1)}%`;

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function CostCenterReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("reports.view", async ({ orgId }) => {
    const sp = await searchParams;
    const from = one(sp.from) || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    const to = one(sp.to) || new Date().toISOString().slice(0, 10);
    const search = one(sp.q).trim().toLowerCase();
    const fromD = new Date(from), toD = new Date(to + "T23:59:59");

    const rows = await db
      .select({
        code: costCenters.code, name: costCenters.nameAr,
        revenue: sql<string>`sum(case when ${accounts.type} = 'REVENUE' then ${journalEntryLines.credit} - ${journalEntryLines.debit} else 0 end)`,
        expense: sql<string>`sum(case when ${accounts.type} = 'EXPENSE' then ${journalEntryLines.debit} - ${journalEntryLines.credit} else 0 end)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
      .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
      .leftJoin(costCenters, eq(costCenters.id, journalEntryLines.costCenterId))
      .where(and(
        eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"),
        inArray(accounts.type, ["REVENUE", "EXPENSE"]),
        gte(journalEntries.date, fromD), lte(journalEntries.date, toD),
      ))
      .groupBy(costCenters.id, costCenters.code, costCenters.nameAr);

    let list = rows.map((r) => {
      const revenue = Number(r.revenue ?? 0), expense = Number(r.expense ?? 0);
      const net = revenue - expense;
      return { code: r.code, name: r.name ?? "غير محدّد", revenue, expense, net, margin: revenue > 0 ? (net / revenue) * 100 : 0 };
    });
    if (search) list = list.filter((r) => r.code?.toLowerCase().includes(search) || r.name.toLowerCase().includes(search));
    list.sort((a, b) => b.net - a.net);

    const tRev = list.reduce((s, r) => s + r.revenue, 0);
    const tExp = list.reduce((s, r) => s + r.expense, 0);
    const tNet = tRev - tExp;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Target" title="الأرباح والخسائر حسب مركز التكلفة" subtitle="الإيراد والمصروف والصافي لكل مركز تكلفة" />
        <ItemSalesFilters from={from} to={to} q={search} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الإيراد</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-emerald-600">{fmt(tRev)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">إجمالي المصروف</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold tabular-nums text-destructive">{fmt(tExp)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">صافي الربح</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold tabular-nums ${tNet >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(tNet)}</p></CardContent></Card>
        </div>

        {list.some((r) => r.revenue > 0 || r.expense > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>الإيراد مقابل المصروف حسب المركز</CardTitle>
              <CardDescription>أبرز ٨ مراكز تكلفة (حسب الصافي).</CardDescription>
            </CardHeader>
            <CardContent>
              <GroupedBarChart
                data={list.slice(0, 8).map((r) => ({ label: r.name, revenue: r.revenue, expense: r.expense }))}
                series={[
                  { key: "revenue", name: "الإيراد", color: "#0d9488" },
                  { key: "expense", name: "المصروف", color: "#d97706" },
                ]}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>حسب مركز التكلفة</CardTitle>
            <CardDescription>الفترة {from} إلى {to} — من القيود المرحّلة. «غير محدّد» = بنود بلا مركز تكلفة.</CardDescription>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركة إيراد/مصروف في هذه الفترة.</div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="text-start">مركز التكلفة</TableHead>
                  <TableHead className="text-end">الإيراد</TableHead>
                  <TableHead className="text-end">المصروف</TableHead>
                  <TableHead className="text-end">الصافي</TableHead>
                  <TableHead className="text-end">الهامش</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {list.map((r, i) => (
                    <TableRow key={r.code ?? i}>
                      <TableCell>{r.code && <span className="font-mono text-xs text-muted-foreground">{r.code} </span>}{r.name}</TableCell>
                      <TableCell className="text-end tabular-nums text-emerald-600">{fmt(r.revenue)}</TableCell>
                      <TableCell className="text-end tabular-nums text-destructive">{fmt(r.expense)}</TableCell>
                      <TableCell className={`text-end tabular-nums font-medium ${r.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(r.net)}</TableCell>
                      <TableCell className="text-end tabular-nums">{r.revenue > 0 ? pct(r.margin) : "—"}</TableCell>
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
