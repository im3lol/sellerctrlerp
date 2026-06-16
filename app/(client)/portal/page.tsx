import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, productStatuses, tasks, workspaces } from "@/db/schema";
import { getWorkspaceStats } from "@/lib/queries/workspace-stats";
import { WORKSPACE_TYPE_LABELS } from "@/lib/workspaces";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDonut } from "@/components/charts/status-donut";
import { EmptyState } from "@/components/empty-state";
import { Package, CheckCircle2, ChevronLeft } from "lucide-react";

export default async function PortalHome() {
  const user = await requireUser();

  const myWorkspaces = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.clientUserId, user.id), eq(workspaces.isArchived, false)));
  const wsIds = myWorkspaces.map((w) => w.id);

  if (wsIds.length === 0) {
    return (
      <div>
        <PageHeader title={`أهلاً، ${user.name}`} description="متابعة تقدم العمل على متاجرك" />
        <EmptyState icon="Briefcase" title="لا توجد مساحات عمل" description="لم يتم ربط أي متجر بحسابك بعد." />
      </div>
    );
  }

  const [stats, [{ total }], [{ done }], [{ openTasks }], dist] = await Promise.all([
    getWorkspaceStats(wsIds),
    db.select({ total: sql<number>`count(*)::int` }).from(products).where(inArray(products.workspaceId, wsIds)),
    db
      .select({ done: sql<number>`count(*)::int` })
      .from(products)
      .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(and(inArray(products.workspaceId, wsIds), eq(productStatuses.isTerminal, true))),
    db
      .select({ openTasks: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(inArray(tasks.workspaceId, wsIds), sql`${tasks.status} <> 'done'`)),
    db
      .select({
        name: productStatuses.name,
        color: productStatuses.color,
        value: sql<number>`count(${products.id})::int`,
      })
      .from(products)
      .innerJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .where(inArray(products.workspaceId, wsIds))
      .groupBy(productStatuses.name, productStatuses.color, productStatuses.sortOrder)
      .orderBy(productStatuses.sortOrder),
  ]);

  const rate = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${user.name}`} description="متابعة تقدم العمل على متاجرك" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="إجمالي المنتجات" value={total} icon="Package" tone="blue" />
        <StatCard label="منتجات مكتملة" value={done} icon="CheckCircle2" tone="green" />
        <StatCard label="نسبة الإنجاز" value={`${rate}%`} icon="TrendingUp" tone="yellow" />
        <StatCard label="مهام جارية" value={openTasks} icon="ListChecks" tone="purple" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <h2 className="font-semibold">متاجرك</h2>
          {myWorkspaces.map((ws) => {
            const s = stats[ws.id];
            return (
              <Link key={ws.id} href={`/portal/workspaces/${ws.id}`}>
                <Card className="flex flex-row items-center gap-4 p-4 transition-shadow hover:shadow-md">
                  <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                    <Package className="size-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{ws.name}</p>
                      <Badge variant="secondary">{WORKSPACE_TYPE_LABELS[ws.type]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {s.productCount} منتج · {s.completedCount} مكتمل
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${s.completion}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-semibold tabular-nums text-primary">
                    {s.completion}%
                    <ChevronLeft className="size-4" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <Card className="p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-4 text-primary" />
            توزيع المنتجات
          </h2>
          <StatusDonut data={dist} />
        </Card>
      </div>
    </div>
  );
}
