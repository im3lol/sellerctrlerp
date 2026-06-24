import Link from "next/link";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { products, productBases, tasks, workspaces, users, productStatuses } from "@/db/schema";
import { can } from "@/lib/rbac";
import { workedSecondsSince } from "@/lib/attendance";
import {
  getStatusDistribution,
  getCompletionTrend,
  getEmployeeKpis,
} from "@/lib/queries/kpi";
import { getActiveOrg } from "@/lib/erp/org";
import { getErpRole } from "@/lib/erp/auth-guard";
import { getErpOverview, type ErpOverview } from "@/lib/erp/overview";
import { orgWorkspaceIds } from "@/lib/crm/scope";
import { cn } from "@/lib/utils";
import { formatDurationAr } from "@/components/attendance/format";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { StatusDonut } from "@/components/charts/status-donut";
import { CompletionLine } from "@/components/charts/completion-line";
import { LeaderboardList } from "@/components/leaderboard/leaderboard-list";
import { StatusBadge } from "@/components/products/status-badge";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export default async function DashboardPage() {
  const user = await requireUser();
  const manager = can(user.role, "workspace.viewAll");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // ERP overview is surfaced here (the unified home) when the user has access to
  // an active organization with an ERP role — so the system's financial/inventory
  // reports lead the dashboard instead of living only under /erp.
  const { org } = await getActiveOrg();
  const erpRole = org ? await getErpRole(org.id, user) : null;

  const [todaySeconds, terminalStatuses, overview] = await Promise.all([
    workedSecondsSince(user.id, startOfDay),
    db.select({ id: productStatuses.id }).from(productStatuses).where(eq(productStatuses.isTerminal, true)),
    org && erpRole ? getErpOverview(org.id) : Promise.resolve(null),
  ]);
  const terminalIds = terminalStatuses.map((s) => s.id);

  return (
    <div className="space-y-6">
      <PageHeader title={`أهلاً، ${user.name.split(" ")[0]} 👋`} description="نظرة عامة سريعة على عملياتك اليوم" />

      {overview && org && <ErpOverviewSection overview={overview} orgName={org.nameAr} />}

      {org ? (
        manager ? (
          <ManagerDashboard orgId={org.id} todaySeconds={todaySeconds} terminalIds={terminalIds} />
        ) : (
          <EmployeeDashboard orgId={org.id} userId={user.id} todaySeconds={todaySeconds} terminalIds={terminalIds} />
        )
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">لا توجد مؤسسة نشطة — تواصل مع المسؤول لإضافتك إلى مؤسسة.</Card>
      )}
    </div>
  );
}

const REPORT_LINKS = [
  { label: "ميزان المراجعة", href: "/erp/reports", icon: "ChartPie" },
  { label: "قائمة الدخل", href: "/erp/reports/income-statement", icon: "TrendingUp" },
  { label: "الميزانية العمومية", href: "/erp/reports/balance-sheet", icon: "Scale" },
  { label: "أعمار الذمم (عملاء)", href: "/erp/sales/aging", icon: "Users" },
  { label: "أعمار الذمم (موردون)", href: "/erp/purchases/aging", icon: "Truck" },
  { label: "أرصدة المخزون", href: "/erp/inventory/stock", icon: "Boxes" },
] as const;

function ErpOverviewSection({ overview: o, orgName }: { overview: ErpOverview; orgName: string }) {
  const kpis = [
    { label: "صافي الربح/الخسارة", value: money(o.net), icon: "TrendingUp", tone: o.net >= 0 ? "green" : "red" },
    { label: "النقدية والبنوك", value: money(o.cash), icon: "Wallet", tone: "blue" },
    { label: "ذمم مدينة (عملاء)", value: money(o.ar), icon: "Users", tone: "purple" },
    { label: "ذمم دائنة (موردون)", value: money(o.ap), icon: "Truck", tone: "yellow" },
    { label: "قيمة المخزون", value: money(o.inventoryValue), icon: "Boxes", tone: "slate" },
  ] as const;

  const alerts = [
    { label: "تحت حد الطلب", value: o.lowStock, href: "/erp/inventory/reorder", tone: o.lowStock ? "text-amber-600" : "text-muted-foreground" },
    { label: "نواقص المخزون", value: o.outOfStock, href: "/erp/inventory/reorder", tone: o.outOfStock ? "text-destructive" : "text-muted-foreground" },
    { label: "قرب الانتهاء", value: o.nearExpiryCount, href: "/erp/inventory/expiry", tone: o.nearExpiryCount ? "text-amber-600" : "text-muted-foreground" },
    { label: "منتهية الصلاحية", value: o.expiredCount, href: "/erp/inventory/expiry", tone: o.expiredCount ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold"><Icon name="Building2" className="size-4 text-primary" /> نظرة عامة على النظام — {orgName}</h2>
        <Link href="/erp/dashboard" className="text-sm text-primary hover:underline">لوحة ERP الكاملة ←</Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} tone={k.tone} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* This month */}
        <Card className="space-y-4 p-5">
          <h3 className="text-sm font-semibold text-muted-foreground">حركة الشهر</h3>
          <div>
            <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Icon name="ReceiptText" className="size-4 text-success" /> مبيعات</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{intf(o.salesCount)}</span></div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-success">{money(o.salesMonth)}</div>
          </div>
          <div className="border-t pt-3">
            <div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2"><Icon name="ShoppingCart" className="size-4 text-primary" /> مشتريات</span><span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{intf(o.purchasesCount)}</span></div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-primary">{money(o.purchasesMonth)}</div>
          </div>
        </Card>

        {/* Alerts */}
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-muted-foreground">تنبيهات المخزون</h3>
          <div className="grid grid-cols-2 gap-2">
            {alerts.map((a) => (
              <Link key={a.label} href={a.href} className="rounded-lg border px-3 py-2 transition-colors hover:border-primary hover:bg-accent">
                <div className="text-xs text-muted-foreground">{a.label}</div>
                <div className={cn("text-xl font-bold tabular-nums", a.tone)}>{intf(a.value)}</div>
              </Link>
            ))}
          </div>
        </Card>

        {/* Report quick links */}
        <Card className="space-y-2 p-5">
          <h3 className="text-sm font-semibold text-muted-foreground">التقارير</h3>
          <div className="grid gap-1.5">
            {REPORT_LINKS.map((r) => (
              <Link key={r.href} href={r.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                <Icon name={r.icon} className="size-4 text-primary" /> <span className="flex-1">{r.label}</span>
                <Icon name="ChevronLeft" className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

async function ManagerDashboard({ orgId, todaySeconds, terminalIds }: { orgId: string; todaySeconds: number; terminalIds: string[] }) {
  const [[{ wsCount }], [{ prodCount }], [{ empCount }], [{ doneCount }], dist, trend, kpis, recent] =
    await Promise.all([
      db.select({ wsCount: sql<number>`count(*)::int` }).from(workspaces).where(and(eq(workspaces.isArchived, false), eq(workspaces.organizationId, orgId))),
      db.select({ prodCount: sql<number>`count(*)::int` }).from(products).where(inArray(products.workspaceId, orgWorkspaceIds(orgId))),
      db.select({ empCount: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "employee")),
      db
        .select({ doneCount: sql<number>`count(*)::int` })
        .from(products)
        .where(and(inArray(products.workspaceId, orgWorkspaceIds(orgId)), terminalIds.length ? inArray(products.statusId, terminalIds) : sql`false`)),
      getStatusDistribution(orgId),
      getCompletionTrend(orgId, 7),
      getEmployeeKpis(orgId),
      db
        .select({
          id: products.id,
          name: productBases.name,
          statusName: productStatuses.name,
          statusColor: productStatuses.color,
          workspaceName: workspaces.name,
        })
        .from(products)
        .leftJoin(productBases, eq(products.baseId, productBases.id))
        .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
        .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
        .where(inArray(products.workspaceId, orgWorkspaceIds(orgId)))
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
  orgId,
  userId,
  todaySeconds,
  terminalIds,
}: {
  orgId: string;
  userId: string;
  todaySeconds: number;
  terminalIds: string[];
}) {
  const [[{ myProducts }], [{ myDone }], [{ myOpenTasks }], trend, myProductsList] = await Promise.all([
    db.select({ myProducts: sql<number>`count(*)::int` }).from(products).where(and(eq(products.assignedTo, userId), inArray(products.workspaceId, orgWorkspaceIds(orgId)))),
    db
      .select({ myDone: sql<number>`count(*)::int` })
      .from(products)
      .where(and(eq(products.assignedTo, userId), inArray(products.workspaceId, orgWorkspaceIds(orgId)), terminalIds.length ? inArray(products.statusId, terminalIds) : sql`false`)),
    db
      .select({ myOpenTasks: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), inArray(tasks.workspaceId, orgWorkspaceIds(orgId)), sql`${tasks.status} <> 'done'`)),
    getCompletionTrend(orgId, 7),
    db
      .select({
        id: products.id,
        name: productBases.name,
        statusName: productStatuses.name,
        statusColor: productStatuses.color,
        workspaceName: workspaces.name,
      })
      .from(products)
      .leftJoin(productBases, eq(products.baseId, productBases.id))
      .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
      .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
      .where(and(eq(products.assignedTo, userId), inArray(products.workspaceId, orgWorkspaceIds(orgId))))
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
