import { sql } from "drizzle-orm";
import { fill } from "@/lib/i18n";
import { getLocale, getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { BarChart } from "@/components/charts/bar-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportShell, ReportField } from "@/components/erp/report-shell";
import { selectCls } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function IncomeStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const locale = await getLocale();
  const t = await getT();
  return loadErpPage("reports.view", async ({ orgId, permissions }) => {
    const sp = await searchParams;

    const now = new Date();
    const from = sp.from || (await orgFiscalYearStartISO(orgId, now));
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
      return { label: d.toLocaleDateString((locale === "en" ? "en-GB" : "ar-EG-u-nu-latn"), { month: "short", year: "2-digit" }), value: netByMonth.get(key) ?? 0 };
    });

    const query = new URLSearchParams({ from, to }).toString();

    return (
      <ReportShell
        reportKey="income-statement"
        icon="TrendingUp"
        title={t("قائمة الدخل")}
        subtitle={fill(t("من {0} إلى {1} — من القيود المُرحّلة"), [from, to])}
        query={query}
        permissions={permissions}
        filters={
          <>
            <ReportField label={t("من تاريخ")}><input name="from" type="date" defaultValue={from} className={selectCls} /></ReportField>
            <ReportField label={t("إلى تاريخ")}><input name="to" type="date" defaultValue={to} className={selectCls} /></ReportField>
          </>
        }
        kpis={[
          { label: "إجمالي الإيرادات", value: fmt(totalRevenue) },
          { op: "−" },
          { label: "إجمالي المصروفات", value: fmt(totalExpense) },
          { op: "=" },
          { label: "صافي الربح", value: fmt(netProfit), tone: netProfit >= 0 ? "profit" : "loss" },
        ]}
        chartTitle={monthlyNet.some((m) => m.value !== 0) ? t("صافي الربح الشهري — آخر ١٢ شهرًا") : undefined}
        chart={monthlyNet.some((m) => m.value !== 0)
          ? <BarChart data={monthlyNet} valueLabel={t("الصافي")} money height={220} colors={monthlyNet.map((m) => (m.value >= 0 ? "#008300" : "#e34948"))} />
          : undefined}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("الإيرادات")}</CardTitle>
              <CardDescription>{t("إجمالي")} {fmt(totalRevenue)}</CardDescription>
            </CardHeader>
            <CardContent>
              <StatementTable rows={revenue} empty={t("لا توجد إيرادات في الفترة.")} totalLabel={t("إجمالي الإيرادات")} total={totalRevenue} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("المصروفات")}</CardTitle>
              <CardDescription>{t("إجمالي")} {fmt(totalExpense)}</CardDescription>
            </CardHeader>
            <CardContent>
              <StatementTable rows={expense} empty={t("لا توجد مصروفات في الفترة.")} totalLabel={t("إجمالي المصروفات")} total={totalExpense} />
            </CardContent>
          </Card>
        </div>

      </ReportShell>
    );
  });
}

async function StatementTable({
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
  const t = await getT();
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed py-10 text-center text-muted-foreground">{empty}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-start">{t("الكود")}</TableHead>
          <TableHead className="text-start">{t("الحساب")}</TableHead>
          <TableHead className="text-start">{t("المبلغ")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.code}>
            <TableCell className="font-mono">{r.code}</TableCell>
            <TableCell>{t(r.nameAr)}</TableCell>
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
