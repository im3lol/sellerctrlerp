import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { profitDistributions } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { DistributionForm } from "@/components/erp/distribution-form";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

export default async function DistributionsPage() {
  const { orgId, can } = await requireErpModule("investors.view");

  const [rows, balances] = await Promise.all([
    db.select({
      id: profitDistributions.id, periodName: profitDistributions.periodName,
      periodStart: profitDistributions.periodStart, periodEnd: profitDistributions.periodEnd,
      distributionDate: profitDistributions.distributionDate,
      totalProfit: profitDistributions.totalProfit, status: profitDistributions.status,
      shares: sql<number>`(SELECT count(*) FROM investor_shares WHERE distribution_id = ${profitDistributions.id})`,
    }).from(profitDistributions).where(eq(profitDistributions.organizationId, orgId))
      .orderBy(desc(profitDistributions.distributionDate)),
    // excludeClosing: this is "what did we earn", the same question the income
    // statement answers — the closing entry would net it to zero for a closed year.
    accountBalances({ orgId, excludeClosing: true }),
  ]);

  const netProfit =
    balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
    balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader icon="PieChart" title="توزيعات الأرباح" subtitle={`${rows.length} توزيع`} backHref="/erp/investors"
        action={can("investors.edit") ? <DistributionForm suggestedProfit={Math.round(netProfit * 100) / 100} /> : undefined}
      />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">لا توجد توزيعات بعد.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-right">
                <tr>
                  <th className="p-3 font-medium">الفترة</th>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">الحصص</th>
                  <th className="p-3 font-medium">الحالة</th>
                  <th className="p-3 text-left font-medium">إجمالي الربح</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="p-3">
                      <Link href={`/erp/investors/distributions/${r.id}`} className="font-medium text-primary hover:underline">
                        {r.periodName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{dt(r.periodStart)} → {dt(r.periodEnd)}</div>
                    </td>
                    <td className="p-3 tabular-nums text-muted-foreground">{dt(r.distributionDate)}</td>
                    <td className="p-3 tabular-nums text-muted-foreground">{Number(r.shares)}</td>
                    <td className="p-3">
                      <Badge variant={r.status === "POSTED" ? "default" : "secondary"}>
                        {r.status === "POSTED" ? "مُرحّل" : "مسودة"}
                      </Badge>
                    </td>
                    <td className="p-3 text-left font-semibold tabular-nums">{money(Number(r.totalProfit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
