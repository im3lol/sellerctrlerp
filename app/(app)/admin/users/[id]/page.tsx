import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc, sql, gte } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import {
  users,
  products,
  productBases,
  productStatuses,
  tasks,
  workspaces,
  workspaceMembers,
  attendance,
  activityLog,
  notifications,
} from "@/db/schema";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/products/status-badge";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { EmptyState } from "@/components/empty-state";
import { formatDateAr } from "@/lib/format";

const TASK_STATUS_AR: Record<string, string> = {
  new: "جديد",
  in_progress: "قيد التنفيذ",
  review: "مراجعة",
  done: "مكتمل",
  blocked: "متوقف",
};

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability("employee.manage");
  const { id } = await params;

  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u || u.role === "client") notFound();

  const monthAgo = new Date(Date.now() - 30 * 86400000);

  const [memberships, prodAgg, assignedProducts, taskAgg, recentTasks, attAgg, activity, notifs] =
    await Promise.all([
      // Workspaces this user belongs to
      db
        .select({ id: workspaces.id, name: workspaces.name, type: workspaces.type, memberRole: workspaceMembers.memberRole })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, id)),
      // Product KPIs (assigned to this user)
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
        })
        .from(products)
        .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
        .where(eq(products.assignedTo, id)),
      // Recent assigned products
      db
        .select({
          id: products.id,
          name: productBases.name,
          statusName: productStatuses.name,
          statusColor: productStatuses.color,
          workspaceName: workspaces.name,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .leftJoin(productBases, eq(products.baseId, productBases.id))
        .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
        .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
        .where(eq(products.assignedTo, id))
        .orderBy(desc(products.updatedAt))
        .limit(12),
      // Task counts by status
      db
        .select({ status: tasks.status, count: sql<number>`count(*)::int` })
        .from(tasks)
        .where(eq(tasks.assigneeId, id))
        .groupBy(tasks.status),
      // Recent tasks
      db
        .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
        .from(tasks)
        .where(eq(tasks.assigneeId, id))
        .orderBy(desc(tasks.updatedAt))
        .limit(10),
      // Attendance (last 30 days)
      db
        .select({
          seconds: sql<number>`coalesce(sum(${attendance.totalSeconds}),0)::int`,
          days: sql<number>`count(*)::int`,
        })
        .from(attendance)
        .where(and(eq(attendance.userId, id), gte(attendance.workDate, monthAgo.toISOString().slice(0, 10)))),
      // Recent activity by this user
      db
        .select({
          id: activityLog.id,
          action: activityLog.action,
          summaryAr: activityLog.summaryAr,
          createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .where(eq(activityLog.actorId, id))
        .orderBy(desc(activityLog.createdAt))
        .limit(15),
      // Notifications sent TO this user (task/products/workspace assigned…)
      db
        .select({
          id: notifications.id,
          title: notifications.title,
          body: notifications.body,
          link: notifications.link,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(eq(notifications.userId, id))
        .orderBy(desc(notifications.createdAt))
        .limit(15),
    ]);

  const totalProducts = prodAgg[0]?.total ?? 0;
  const completedProducts = prodAgg[0]?.completed ?? 0;
  const completion = totalProducts ? Math.round((completedProducts / totalProducts) * 100) : 0;
  const taskCounts = Object.fromEntries(taskAgg.map((t) => [t.status, t.count]));
  const openTasks = (taskCounts.new ?? 0) + (taskCounts.in_progress ?? 0) + (taskCounts.review ?? 0);
  const doneTasks = taskCounts.done ?? 0;
  const hours = Math.round(((attAgg[0]?.seconds ?? 0) / 3600) * 10) / 10;
  const init = u.name.split(" ").slice(0, 2).map((p) => p[0]).join("");

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/admin/users" className="hover:text-foreground">الموظفون</Link>
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-foreground">{u.name}</span>
      </nav>

      <PageHeader title={u.name} description={u.title ?? ROLE_LABELS_AR[u.role as Role]} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="منتجات مُسندة" value={totalProducts} icon="Package" tone="blue" />
            <StatCard label="مكتملة" value={completedProducts} icon="CheckCircle2" tone="green" hint={`${completion}% إنجاز`} />
            <StatCard label="مهام مفتوحة" value={openTasks} icon="ListChecks" tone="yellow" />
            <StatCard label="ساعات (30 يوم)" value={hours} icon="Clock" tone="purple" hint={`${attAgg[0]?.days ?? 0} يوم حضور`} />
          </div>

          {/* Assigned products */}
          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">المنتجات المُسندة</h2>
              <Link href={`/products?assignedTo=${id}`} className="text-sm text-primary hover:underline">عرض الكل</Link>
            </div>
            {assignedProducts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد منتجات مُسندة.</p>
            ) : (
              <div className="divide-y">
                {assignedProducts.map((p) => (
                  <Link key={p.id} href={`/products/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.workspaceName}</p>
                    </div>
                    {p.statusName && <StatusBadge name={p.statusName} color={p.statusColor ?? "#94a3b8"} />}
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Tasks */}
          <Card className="p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">المهام</h2>
              <span className="text-sm text-muted-foreground">{doneTasks} مكتملة · {openTasks} مفتوحة</span>
            </div>
            {recentTasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد مهام.</p>
            ) : (
              <div className="divide-y">
                {recentTasks.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-primary">
                    <p className="min-w-0 truncate font-medium">{t.title}</p>
                    <StatusBadge name={TASK_STATUS_AR[t.status] ?? t.status} color="#0A33D1" />
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Notifications sent to the employee */}
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">الإشعارات</h2>
            {notifs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لا توجد إشعارات.</p>
            ) : (
              <ul className="divide-y">
                {notifs.map((n) => {
                  const item = (
                    <div className="flex items-start gap-3 py-2.5">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-muted-foreground/30" : "bg-primary"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                        <p className="text-xs text-muted-foreground">{formatDateAr(n.createdAt, true)}</p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id}>
                      {n.link ? (
                        <Link href={n.link} className="block hover:text-primary">{item}</Link>
                      ) : (
                        item
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Activity */}
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">النشاط الأخير</h2>
            {activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">لا يوجد نشاط.</p>
            ) : (
              <ActivityFeed items={activity.map((a) => ({ ...a, actorName: u.name, actorAvatar: u.avatarUrl }))} />
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <Avatar className="size-20">
              {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
              <AvatarFallback className="bg-primary/10 text-xl text-primary">{init}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-lg font-bold">{u.name}</p>
              <p className="text-sm text-muted-foreground" dir="ltr">{u.email}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge variant="secondary">{ROLE_LABELS_AR[u.role as Role]}</Badge>
              <Badge variant={u.isActive ? "default" : "outline"}>{u.isActive ? "نشط" : "غير نشط"}</Badge>
            </div>
          </Card>

          <Card className="space-y-3 p-5 text-sm">
            <Row label="المسمى الوظيفي" value={u.title ?? "—"} />
            <Row label="تاريخ الانضمام" value={u.hiredAt ? formatDateAr(u.hiredAt) : "—"} />
            <Row label="معدل الإنجاز" value={`${completion}%`} />
          </Card>

          {/* Workspaces */}
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">مساحات العمل</h2>
            {memberships.length === 0 ? (
              <EmptyState icon="Briefcase" title="لا مساحات" description="غير مضاف لأي مساحة عمل." />
            ) : (
              <div className="space-y-2">
                {memberships.map((w) => (
                  <Link key={w.id} href={`/workspaces/${w.id}`} className="flex items-center justify-between rounded-xl border p-3 text-sm hover:bg-muted/50">
                    <span className="font-medium">{w.name}</span>
                    <Badge variant="outline">{ROLE_LABELS_AR[w.memberRole as Role]}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
