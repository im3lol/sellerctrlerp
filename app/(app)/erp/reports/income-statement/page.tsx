import { sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportTabs } from "@/components/erp/report-tabs";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { orgId } = await requireErpModule("reports.view");
  const sp = await searchParams;

  const now = new Date();
  const from = sp.from || `${now.getFullYear()}-01-01`;
  const to = sp.to || iso(now);

  const balances = await accountBalances({
    orgId,
    from: new Date(from),
    to: new Date(`${to}T23:59:59`),
    excludeClosing: true,
  });

  const revenue = balances
    .filter((b) => b.type === "REVENUE")
    .map((b) => ({ ...b, amount: naturalAmount(b) }))
    .filter((b) => b.amount !== 0);
  const expense = balances
    .filter((b) => b.type === "EXPENSE")
    .map((b) => ({ ...b, amount: naturalAmount(b) }))
    .filter((b) => b.amount !== 0);

  const totalRevenue = revenue.reduce((s, b) => s + b.amount, 0);
  const totalExpense = expense.reduce((s, b) => s + b.amount, 0);
  const netProfit = totalRevenue - totalExpense;

  // Monthly net profit for the trailing 12 months (independent of the period
  // filter). P&L accounts net to income as Σ(credit − debit).
  const plSince = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const plRows = (await db.execute<{ m: string; net: string }>(sql`
    SELECT to_char(date_trunc('month', je.date), 'YYYY-MM') AS m,
      COALESCE(SUM(l.credit - l.debit), 0) AS net
    FROM journal_entry_lines l
    JOIN journal_entries je ON je.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE je.organization_id = ${orgId} AND je.status = 'POSTED' AND je.date >= ${plSince}
      AND a.type IN ('REVENUE', 'EXPENSE')
      AND je.source_type IS DISTINCT FROM 'YEAR_CLOSING'
    GROUP BY 1`)).rows as { m: string; net: string }[];
  const netByMonth = new Map(plRows.map((r) => [r.m, Number(r.net)]));
  const monthlyNet = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { label: d.toLocaleDateString("ar-EG-u-nu-latn", { month: "short", year: "2-digit" }), value: netByMonth.get(key) ?? 0 };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="TrendingUp"
        title="قائمة الدخل"
        subtitle={`من ${from} إلى ${to} — من القيود المُرحّلة`}
        action={
          <Button asChild variant="outline">
            <a href={`/api/erp/reports/income-statement/export?${new URLSearchParams({ from, to }).toString()}`}><Icon name="Download" className="size-4" />Excel</a>
          </Button>
        }
      />
      <ReportTabs active="/erp/reports/income-statement" />

      <Card>
        <CardHeader>
          <CardTitle>الفترة</CardTitle>
          <CardDescription>اختر فترة قائمة الدخل.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="from">من تاريخ</Label>
              <input id="from" name="from" type="date" defaultValue={from} className={selectCls} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">إلى تاريخ</Label>
              <input id="to" name="to" type="date" defaultValue={to} className={selectCls} />
            </div>
            <Button type="submit">عرض</Button>
          </form>
        </CardContent>
      </Card>

      {monthlyNet.some((m) => m.value !== 0) && (
        <Card>
          <CardHeader>
            <CardTitle>صافي الربح الشهري</CardTitle>
            <CardDescription>آخر ١٢ شهرًا — أخضر ربح، أحمر خسارة.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart data={monthlyNet} valueLabel="الصافي" money height={220} colors={monthlyNet.map((m) => (m.value >= 0 ? "#008300" : "#e34948"))} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الإيرادات</CardTitle>
            <CardDescription>إجمالي {fmt(totalRevenue)}</CardDescription>
          </CardHeader>
          <CardContent>
            <StatementTable rows={revenue} empty="لا توجد إيرادات في الفترة." totalLabel="إجمالي الإيرادات" total={totalRevenue} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>المصروفات</CardTitle>
            <CardDescription>إجمالي {fmt(totalExpense)}</CardDescription>
          </CardHeader>
          <CardContent>
            <StatementTable rows={expense} empty="لا توجد مصروفات في الفترة." totalLabel="إجمالي المصروفات" total={totalExpense} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between py-6">
          <div className="text-lg font-semibold">صافي الربح / (الخسارة)</div>
          <div className="flex items-center gap-3">
            <Badge variant={netProfit >= 0 ? "default" : "destructive"}>{netProfit >= 0 ? "ربح" : "خسارة"}</Badge>
            <span className={`text-2xl font-bold ${netProfit >= 0 ? "text-emerald-600" : "text-destructive"}`}>
              {fmt(netProfit)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatementTable({
  rows,
  empty,
  totalLabel,
  total,
}: {
  rows: { code: string; nameAr: string; amount: number }[];
  empty: string;
  totalLabel: string;
  total: number;
}) {
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">{empty}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-start">الكود</TableHead>
          <TableHead className="text-start">الحساب</TableHead>
          <TableHead className="text-start">المبلغ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.code}>
            <TableCell className="font-mono">{r.code}</TableCell>
            <TableCell>{r.nameAr}</TableCell>
            <TableCell>{fmt(r.amount)}</TableCell>
          </TableRow>
        ))}
        <TableRow className="font-bold">
          <TableCell colSpan={2}>{totalLabel}</TableCell>
          <TableCell>{fmt(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
