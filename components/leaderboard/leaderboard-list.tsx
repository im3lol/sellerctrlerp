import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { EmployeeKpi } from "@/lib/queries/kpi";

const MEDALS = ["🥇", "🥈", "🥉"];

export function LeaderboardList({ kpis }: { kpis: EmployeeKpi[] }) {
  return (
    <div className="divide-y rounded-2xl border bg-card">
      {kpis.map((k, i) => {
        const init = k.name.split(" ").slice(0, 2).map((p) => p[0]).join("");
        return (
          <div key={k.id} className="flex items-center gap-4 p-4">
            <div className={cn("w-8 text-center text-lg font-bold", i > 2 && "text-sm text-muted-foreground")}>
              {MEDALS[i] ?? i + 1}
            </div>
            <Avatar className="size-10">
              {k.avatarUrl && <AvatarImage src={k.avatarUrl} />}
              <AvatarFallback className="bg-primary/10 text-primary">{init}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{k.name}</p>
              <p className="text-xs text-muted-foreground">
                {k.completed} مكتمل من {k.total} · {k.openTasks} مهمة مفتوحة
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold tabular-nums text-primary">{k.completionRate}%</p>
              <p className="text-xs text-muted-foreground">نسبة الإنجاز</p>
            </div>
            {k.avgHours != null && (
              <div className="hidden text-center sm:block">
                <p className="font-semibold tabular-nums">{k.avgHours}س</p>
                <p className="text-xs text-muted-foreground">متوسط الإنجاز</p>
              </div>
            )}
          </div>
        );
      })}
      {kpis.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">لا يوجد موظفون</p>}
    </div>
  );
}
