import Link from "next/link";
import { requireCrm } from "@/lib/crm/guard";
import { pool } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  total: number;
  completed: number;
  in_progress: number;
  stale: number;
  open_tasks: number;
};

export default async function MonitoringPage() {
  const { orgId } = await requireCrm("reports.view");

  // Org-scoped: only products/tasks in the active org's workspaces are counted.
  const { rows } = await pool.query(
    `SELECT u.id, u.name,
            count(p.id) FILTER (WHERE p.assigned_to IS NOT NULL) AS total,
            count(p.id) FILTER (WHERE COALESCE(s.is_terminal, false)) AS completed,
            count(p.id) FILTER (WHERE p.assigned_to IS NOT NULL AND NOT COALESCE(s.is_terminal, false)) AS in_progress,
            count(p.id) FILTER (WHERE NOT COALESCE(s.is_terminal, false) AND p.assigned_to IS NOT NULL
                                 AND p.updated_at < now() - interval '3 days') AS stale,
            (SELECT count(*)::int FROM tasks t
              WHERE t.assignee_id = u.id AND t.status <> 'done'
                AND t.workspace_id IN (SELECT id FROM workspaces WHERE organization_id = $1)) AS open_tasks
       FROM users u
       LEFT JOIN products p ON p.assigned_to = u.id AND p.is_draft = false
            AND p.workspace_id IN (SELECT id FROM workspaces WHERE organization_id = $1)
       LEFT JOIN product_statuses s ON s.id = p.status_id
      WHERE u.role = 'employee' AND u.is_active = true
      GROUP BY u.id, u.name
      ORDER BY stale DESC, total DESC`,
    [orgId],
  );

  const data = (rows as Row[]).map((r) => ({
    ...r,
    total: Number(r.total),
    completed: Number(r.completed),
    in_progress: Number(r.in_progress),
    stale: Number(r.stale),
    open_tasks: Number(r.open_tasks),
    completion: Number(r.total) ? Math.round((Number(r.completed) / Number(r.total)) * 100) : 0,
  }));

  const totals = data.reduce(
    (a, r) => ({
      assigned: a.assigned + r.total,
      completed: a.completed + r.completed,
      stale: a.stale + r.stale,
    }),
    { assigned: 0, completed: 0, stale: 0 },
  );

  return (
    <div>
      <PageHeader title="متابعة الأداء" description="تقدّم كل موظف لحظياً — مين خلّص، مين متأخر" />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="موظفون نشطون" value={data.length} icon="Users" tone="slate" />
        <StatCard label="منتجات مُسندة" value={totals.assigned} icon="Package" tone="blue" />
        <StatCard label="مكتملة" value={totals.completed} icon="CheckCircle2" tone="green" />
        <StatCard label="متأخرة (بدون حركة +3 أيام)" value={totals.stale} icon="AlertTriangle" tone="red" />
      </div>

      {data.length === 0 ? (
        <EmptyState icon="Users" title="لا يوجد موظفون" />
      ) : (
        <Card className="divide-y p-0">
          {data.map((r) => {
            const init = r.name.split(" ").slice(0, 2).map((p) => p[0]).join("");
            return (
              <Link
                key={r.id}
                href={`/admin/users/${r.id}`}
                className="flex flex-wrap items-center gap-4 p-4 transition hover:bg-muted/40"
              >
                <Avatar className="size-10">
                  <AvatarFallback className="bg-primary/10 text-primary">{init}</AvatarFallback>
                </Avatar>
                <div className="min-w-[140px] flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{r.name}</p>
                    {r.stale > 0 && (
                      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
                        متأخر: {r.stale}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${r.completion}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  <Stat label="مُسند" value={r.total} />
                  <Stat label="مكتمل" value={r.completed} tone="text-emerald-600" />
                  <Stat label="قيد العمل" value={r.in_progress} />
                  <Stat label="مهام مفتوحة" value={r.open_tasks} />
                  <Stat label="الإنجاز" value={`${r.completion}%`} />
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="text-center">
      <p className={`font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
