import Link from "next/link";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, tasks, workspaces, users, productStatuses } from "@/db/schema";
import { can } from "@/lib/rbac";
import { workedSecondsSince } from "@/lib/attendance";
import {
  getStatusDistribution,
  getCompletionTrend,
  getEmployeeKpis,
} from "@/lib/queries/kpi";
import { formatDurationAr } from "@/components/attendance/format";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { StatusDonut } from "@/components/charts/status-donut";
import { CompletionLine } from "@/components/charts/completion-line";
import { LeaderboardList } from "@/components/leaderboard/leaderboard-list";
import { StatusBadge } from "@/components/products/status-badge";

export default async function DashboardPage() {
  const user = await requireUser();
  const manager = can(user.role, "workspace.viewAll");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todaySeconds = await workedSecondsSince(user.id, startOfDay);

  const terminalStatuses = await db
    .select({ id: productStatuses.id })
    .from(productStatuses)
    .where(eq(productStatuses.isTerminal, true));
  const terminalIds = terminalStatuses.map((s) => s.id);

  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${user.name.split(" ")[0]} 👋`} description="نظرة عامة سريعة على عملياتك اليوم" />

      {manager ? (
        <ManagerDashboard todaySeconds={todaySeconds} terminalIds={terminalIds} />
      ) : (
        <EmployeeDashboard userId={user.id} todaySeconds={todaySeconds} terminalIds={terminalIds} />
      )}
    </div>
  );
}

async function ManagerDashboard({ todaySeconds, terminalIds }: { todaySeconds: number; terminalIds: string[] }) {
  const [[{ wsCount }], [{ prodCount }], [{ empCount }], [{ doneCount }], dist, trend, kpis, recent] =
    await Promise.all([
      db.select({ wsCount: sql<number>`count(*)::int` }).from(workspaces).where(eq(workspaces.isArchived, false)),
      db.select({ prodCount: sql<number>`count(*)::int` }).from(products),
      db.select({ empCount: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "employee")),
      db
        .select({ doneCount: sql<number>`count(*)::int` })
        .from(products)
        .where(terminalIds.length ? inArray(products.statusId, terminalIds) : sql`false`),
      getStatusDistribution(),
      getCompletionTrend(7),
      getEmployeeKpis(),
      db
        .select({
          id: products.id,
          name: products.name,
          statusName: productStatuses.name,
          statusColor: productStatuses.color,
          workspaceName: workspaces.name,
        })
        .from(products)
        .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
        .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
        .orderBy(desc(products.updatedAt))
        .limit(6),
    ]);
  const rate = prodCount > 0 ? Math.round((doneCount / prodCount) * 100) : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="ساعات اليوم" value={formatDurationAr(todaySeconds)} icon="Clock" tone="yellow" />
        <StatCard label="مساحات العمل" value={wsCount} icon="Briefcase" tone="blue" />
        <StatCard label="إجمالي المنتجات" value={prodCount} icon="Package" tone="purple" />
        <StatCard label="عدد الموظفين" value={empCount} icon="Users" tone="slate" />
        <StatCard label="نسبة الإنجاز" value={`${rate}%`} icon="TrendingUp" tone="green" hint={`${doneCount} مكتمل`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 font-semibold">الإنجاز خلال الأسبوع</h2>
          <CompletionLine data={trend} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">توزيع المنتجات</h2>
          <StatusDonut data={dist} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">أفضل الموظفين</h2>
            <Link href="/leaderboard" className="text-sm text-primary hover:underline">عرض الكل</Link>
          </div>
          <LeaderboardList kpis={kpis.slice(0, 5)} />
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">آخر المنتجات</h2>
            <Link href="/products" className="text-sm text-primary hover:underline">عرض الكل</Link>
          </div>
          <div className="divide-y">
            {recent.map((p) => (
              <Link key={p.id} href={`/products/${p.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.workspaceName}</p>
                </div>
                <StatusBadge name={p.statusName} color={p.statusColor} />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

async function EmployeeDashboard({
  userId,
  todaySeconds,
  terminalIds,
}: {
  userId: string;
  todaySeconds: number;
  terminalIds: string[];
}) {
  const [[{ myProducts }], [{ myDone }], [{ myOpenTasks }], trend, myProductsList] = await Promise.all([
    db.select({ myProducts: sql<number>`count(*)::int` }).from(products).where(eq(products.assignedTo, userId)),
    db
      .select({ myDone: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.assignedTo, userId), terminalIds.length ? inArray(products.statusId, terminalIds) : sql`false`)),
    db
      .select({ myOpenTasks: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), sql`${tasks.status} <> 'done'`)),
    getCompletionTrend(7),
    db
      .select({
        id: products.id,
        name: products.name,
        statusName: productStatuses.name,
        statusColor: productStatuses.color,
        workspaceName: workspaces.name,
      })
      .from(products)
      .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(eq(products.assignedTo, userId))
      .orderBy(desc(products.updatedAt))
      .limit(8),
  ]);
  const rate = myProducts > 0 ? Math.round((myDone / myProducts) * 100) : 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ساعات اليوم" value={formatDurationAr(todaySeconds)} icon="Clock" tone="yellow" />
        <StatCard label="منتجاتي" value={myProducts} icon="Package" tone="blue" />
        <StatCard label="مهام مفتوحة" value={myOpenTasks} icon="ListChecks" tone="purple" />
        <StatCard label="نسبة إنجازي" value={`${rate}%`} icon="TrendingUp" tone="green" hint={`${myDone} مكتمل`} />
      </div>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">المنتجات المكلّف بها</h2>
        <div className="divide-y">
          {myProductsList.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">لا توجد منتجات مكلّف بها</p>}
          {myProductsList.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className="flex items-center justify-between gap-2 py-2.5 hover:opacity-80">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.workspaceName}</p>
              </div>
              <StatusBadge name={p.statusName} color={p.statusColor} />
            </Link>
          ))}
        </div>
      </Card>
    </>
  );
}
