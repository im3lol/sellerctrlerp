import { getEmployeeKpis } from "@/lib/queries/kpi";
import { requireCrm } from "@/lib/crm/guard";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { LeaderboardList } from "@/components/leaderboard/leaderboard-list";

export default async function LeaderboardPage() {
  const { orgId } = await requireCrm();
  const kpis = await getEmployeeKpis(orgId);

  const top = kpis[0];
  const fastest = [...kpis].filter((k) => k.avgHours != null).sort((a, b) => (a.avgHours ?? 0) - (b.avgHours ?? 0))[0];
  const mostProductive = [...kpis].sort((a, b) => b.completed - a.completed)[0];

  return (
    <div>
      <PageHeader title="المتصدرون" description="ترتيب الموظفين حسب الإنتاجية والإنجاز" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="أفضل موظف" value={top?.name ?? "—"} icon="Trophy" tone="yellow" hint={top ? `${top.completionRate}% إنجاز` : undefined} />
        <StatCard label="أعلى إنتاجية" value={mostProductive?.name ?? "—"} icon="Zap" tone="blue" hint={mostProductive ? `${mostProductive.completed} منتج` : undefined} />
        <StatCard label="أسرع موظف" value={fastest?.name ?? "—"} icon="Timer" tone="green" hint={fastest?.avgHours != null ? `${fastest.avgHours} ساعة` : undefined} />
      </div>

      <LeaderboardList kpis={kpis} />
    </div>
  );
}
