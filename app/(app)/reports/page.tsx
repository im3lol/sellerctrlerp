import Link from "next/link";
import {
  getReportTotals,
  getCompletionTrend,
  getStatusDistribution,
  getEmployeeKpis,
} from "@/lib/queries/kpi";
import { requireCrm } from "@/lib/crm/guard";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { CompletionLine } from "@/components/charts/completion-line";
import { StatusDonut } from "@/components/charts/status-donut";
import { LeaderboardList } from "@/components/leaderboard/leaderboard-list";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "day", label: "يومي", days: 1 },
  { key: "week", label: "أسبوعي", days: 7 },
  { key: "month", label: "شهري", days: 30 },
];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { orgId } = await requireCrm("reports.view");
  const { period = "week" } = await searchParams;
  const sel = PERIODS.find((p) => p.key === period) ?? PERIODS[1];

  const [totals, trend, dist, kpis] = await Promise.all([
    getReportTotals(orgId, sel.days),
    getCompletionTrend(orgId, sel.days <= 7 ? 7 : 30),
    getStatusDistribution(orgId),
    getEmployeeKpis(orgId),
  ]);

  return (
    <div>
      <PageHeader title="التقارير" description="تقارير الأداء والإنجاز">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/reports?period=${p.key}`}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition",
                sel.key === p.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="منتجات جديدة" value={totals.created} icon="PackagePlus" tone="blue" />
        <StatCard label="منتجات مكتملة" value={totals.completed} icon="CheckCircle2" tone="green" />
        <StatCard
          label="معدل الإنجاز"
          value={totals.created > 0 ? `${Math.round((totals.completed / Math.max(totals.created, 1)) * 100)}%` : "0%"}
          icon="TrendingUp"
          tone="yellow"
        />
        <StatCard label="عدد الموظفين" value={kpis.length} icon="Users" tone="slate" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">الإنجاز عبر الأيام</h2>
          <CompletionLine data={trend} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">توزيع المنتجات</h2>
          <StatusDonut data={dist} />
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold">أداء الموظفين</h2>
        <LeaderboardList kpis={kpis.slice(0, 8)} />
      </Card>
    </div>
  );
}
