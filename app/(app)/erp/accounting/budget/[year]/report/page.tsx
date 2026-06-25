import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accountBudgets, accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const fmt = (v: number) =>
  Math.abs(v).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Params = { params: Promise<{ year: string }> };

export default async function BudgetReportPage({ params }: Params) {
  const year = parseInt((await params).year, 10);
  const { orgId } = await requireErpModule("accounting.view");

  const yearStart = new Date(year, 0, 1);
  const yearEnd   = new Date(year + 1, 0, 1);

  // Load all leaf P&L accounts
  const accs = await db
    .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), inArray(accounts.type, ["REVENUE", "EXPENSE"])))
    .orderBy(accounts.code);

  // Load budget
  const budgetRows = await db
    .select({ accountId: accountBudgets.accountId, amount: accountBudgets.amount })
    .from(accountBudgets)
    .where(and(eq(accountBudgets.organizationId, orgId), eq(accountBudgets.year, year)));
  const budgetMap = Object.fromEntries(budgetRows.map((r) => [r.accountId, Number(r.amount)]));

  // Load actuals from GL — net activity per leaf account for the year
  const actualRows = await db
    .select({
      accountId: journalEntryLines.accountId,
      debit:  sql<string>`coalesce(sum(${journalEntryLines.debit}),0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}),0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .where(
      and(
        eq(journalEntries.organizationId, orgId),
        eq(journalEntries.status, "POSTED"),
        sql`${journalEntries.date} >= ${yearStart}`,
        sql`${journalEntries.date} < ${yearEnd}`,
        inArray(journalEntryLines.accountId, accs.map((a) => a.id)),
      ),
    )
    .groupBy(journalEntryLines.accountId);
  const actualMap = Object.fromEntries(
    actualRows.map((r) => [r.accountId, { debit: Number(r.debit), credit: Number(r.credit) }]),
  );

  // Compute natural balance per account type:
  //   REVENUE: credit - debit (credit normal balance)
  //   EXPENSE: debit - credit (debit normal balance)
  const rows = accs.map((a) => {
    const act = actualMap[a.id] ?? { debit: 0, credit: 0 };
    const actual = a.type === "REVENUE" ? act.credit - act.debit : act.debit - act.credit;
    const budget = budgetMap[a.id] ?? 0;
    const variance = actual - budget;
    const pct = budget !== 0 ? (actual / budget) * 100 : null;
    return { ...a, actual, budget, variance, pct };
  });

  const revenues = rows.filter((r) => r.type === "REVENUE");
  const expenses = rows.filter((r) => r.type === "EXPENSE");

  const totRevBudget  = revenues.reduce((s, r) => s + r.budget, 0);
  const totRevActual  = revenues.reduce((s, r) => s + r.actual, 0);
  const totExpBudget  = expenses.reduce((s, r) => s + r.budget, 0);
  const totExpActual  = expenses.reduce((s, r) => s + r.actual, 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BarChart2"
        title={`تقرير الميزانية ${year}`}
        subtitle="مقارنة الفعلي بالمخطط لكل حساب إيرادات ومصروفات"
        backHref="/erp/accounting/budget"
        action={
          <Button variant="outline" asChild>
            <Link href={`/erp/accounting/budget/${year}`}><Icon name="Edit" className="size-4" />تعديل الميزانية</Link>
          </Button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryTile label="إيرادات مخطط" value={totRevBudget} color="text-success" />
        <SummaryTile label="إيرادات فعلي" value={totRevActual} color="text-success" />
        <SummaryTile label="مصروفات مخطط" value={totExpBudget} color="text-destructive" />
        <SummaryTile label="مصروفات فعلي" value={totExpActual} color="text-destructive" />
      </div>

      {/* Net row */}
      <div className="grid grid-cols-2 gap-4">
        <SummaryTile label="صافي مخطط" value={totRevBudget - totExpBudget} color={(totRevBudget - totExpBudget) >= 0 ? "text-success" : "text-destructive"} />
        <SummaryTile label="صافي فعلي" value={totRevActual - totExpActual} color={(totRevActual - totExpActual) >= 0 ? "text-success" : "text-destructive"} />
      </div>

      {revenues.length > 0 && <BudgetTable title="الإيرادات" rows={revenues} totalBudget={totRevBudget} totalActual={totRevActual} />}
      {expenses.length > 0 && <BudgetTable title="المصروفات" rows={expenses} totalBudget={totExpBudget} totalActual={totExpActual} />}
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: number; color: string }) {
  const fmt2 = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", color)}>{fmt2(value)}</p>
    </div>
  );
}

function BudgetTable({
  title,
  rows,
  totalBudget,
  totalActual,
}: {
  title: string;
  rows: { id: string; code: string; nameAr: string; actual: number; budget: number; variance: number; pct: number | null }[];
  totalBudget: number;
  totalActual: number;
}) {
  const totalVariance = totalActual - totalBudget;
  const totalPct = totalBudget !== 0 ? (totalActual / totalBudget) * 100 : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start">الحساب</th>
              <th className="px-4 py-2 text-end">الميزانية</th>
              <th className="px-4 py-2 text-end">الفعلي</th>
              <th className="px-4 py-2 text-end">الفرق</th>
              <th className="px-4 py-2 text-end">النسبة</th>
              <th className="px-4 py-2 text-end w-28">تحقق</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                  {" "}{r.nameAr}
                </td>
                <td className="px-4 py-2 text-end tabular-nums">{r.budget > 0 ? fmt(r.budget) : "—"}</td>
                <td className={cn("px-4 py-2 text-end tabular-nums", r.actual < 0 ? "text-destructive" : "")}>{fmt(r.actual)}</td>
                <td className={cn("px-4 py-2 text-end tabular-nums", r.variance < 0 ? "text-destructive" : r.variance > 0 ? "text-success" : "")}>
                  {r.variance !== 0 ? `${r.variance >= 0 ? "+" : "-"}${fmt(r.variance)}` : "—"}
                </td>
                <td className="px-4 py-2 text-end tabular-nums text-muted-foreground">
                  {r.pct !== null ? `${r.pct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-4 py-2 text-end">
                  {r.budget > 0 && r.pct !== null ? (
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full transition-all", r.pct > 100 ? "bg-destructive" : "bg-success")}
                          style={{ width: `${Math.min(r.pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/30 font-semibold">
              <td className="px-4 py-2">الإجمالي</td>
              <td className="px-4 py-2 text-end tabular-nums">{fmt(totalBudget)}</td>
              <td className="px-4 py-2 text-end tabular-nums">{fmt(totalActual)}</td>
              <td className={cn("px-4 py-2 text-end tabular-nums", totalVariance < 0 ? "text-destructive" : totalVariance > 0 ? "text-success" : "")}>
                {totalVariance !== 0 ? `${totalVariance >= 0 ? "+" : "-"}${fmt(totalVariance)}` : "—"}
              </td>
              <td className="px-4 py-2 text-end tabular-nums text-muted-foreground">
                {totalPct !== null ? `${totalPct.toFixed(1)}%` : "—"}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </CardContent>
    </Card>
  );
}
