import Link from "next/link";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, leaveRequests, payrollRuns, expenseClaims } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AcademyLink } from "@/components/erp/academy-link";
import { NeedsAttention } from "@/components/erp/needs-attention";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const cnt = (v: { n: number }[]) => Number(v[0]?.n ?? 0);

const SHORTCUTS = [
  { label: "الموظفون", href: "/hr/employees", icon: "UsersRound", key: "employees" },
  { label: "الإجازات", href: "/hr/leaves", icon: "CalendarDays", key: "leaves" },
  { label: "طلب إجازة جديد", href: "/hr/leaves/new", icon: "Plus" },
  { label: "تقرير الإجازات", href: "/hr/leaves/report", icon: "BarChart3" },
  { label: "مسير الرواتب", href: "/hr/payroll", icon: "Banknote", key: "payroll" },
  { label: "مسير رواتب جديد", href: "/hr/payroll/new", icon: "Plus" },
  { label: "مطالبات المصروفات", href: "/hr/expense-claims", icon: "ReceiptText", key: "claims" },
  { label: "تقويم العطلات", href: "/hr/holidays", icon: "CalendarOff" },
];

/**
 * The الموارد البشرية module overview.
 *
 * /erp/hr was a 404: the nav heading pointed straight at /erp/hr/employees, so the
 * module had no landing page and the employee master had no nav entry of its own —
 * the same shape as المشتريات/المبيعات before the split.
 */
export default async function ErpHrPage() {
  return loadErpPage("hr.view", async ({ orgId }) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [active, inactive, leavePending, claimsPending, runDraft, leaveMonth, payroll, byDept] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))),
      db.select({ n: sql<number>`count(*)` }).from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, false))),
      db.select({ n: sql<number>`count(*)` }).from(leaveRequests).where(and(eq(leaveRequests.organizationId, orgId), eq(leaveRequests.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(expenseClaims).where(and(eq(expenseClaims.organizationId, orgId), eq(expenseClaims.status, "DRAFT"))),
      db.select({ n: sql<number>`count(*)` }).from(payrollRuns).where(and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.status, "DRAFT"))),
      db.select({ n: sql<number>`coalesce(sum(${leaveRequests.days}), 0)` }).from(leaveRequests)
        .where(and(eq(leaveRequests.organizationId, orgId), eq(leaveRequests.status, "APPROVED"), gte(leaveRequests.startDate, monthStart))),
      // Monthly payroll cost of the active roster. Hourly staff have no monthly figure
      // (basicSalary is their rate), so they are excluded rather than counted as if
      // they earned their hourly rate once a month.
      db.select({
        v: sql<string>`coalesce(sum(${employees.basicSalary} + ${employees.allowances} - ${employees.deductions}), 0)`,
      }).from(employees).where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true), eq(employees.payType, "MONTHLY"))),
      db.select({ dept: employees.department, n: sql<number>`count(*)` }).from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
        .groupBy(employees.department).orderBy(desc(sql`count(*)`)),
    ]);

    const monthlyCost = Number(payroll[0]?.v ?? 0);
    const depts = byDept.map((d) => ({ name: d.dept?.trim() || "بدون قسم", n: Number(d.n) }));
    const maxDept = Math.max(...depts.map((d) => d.n), 1);

    const todos = [
      { label: "طلبات إجازة بانتظار الاعتماد", hint: "مسودة", count: cnt(leavePending), href: "/hr/leaves", icon: "CalendarDays" },
      { label: "مطالبات مصروفات بانتظار الاعتماد", hint: "مسودة", count: cnt(claimsPending), href: "/hr/expense-claims", icon: "ReceiptText" },
      { label: "مسيّرات رواتب مسودة", hint: "بانتظار الترحيل", count: cnt(runDraft), href: "/hr/payroll", icon: "Banknote" },
    ];

    const counts: Record<string, number> = {
      employees: cnt(active), leaves: cnt(leavePending), payroll: cnt(runDraft), claims: cnt(claimsPending),
    };

    const kpis = [
      { label: "الموظفون النشطون", value: cnt(active), icon: "UsersRound", int: true, tone: "text-foreground" },
      { label: "تكلفة الرواتب الشهرية", value: monthlyCost, icon: "Banknote", tone: "text-foreground" },
      { label: "أيام إجازة معتمدة هذا الشهر", value: Number(leaveMonth[0]?.n ?? 0), icon: "CalendarDays", int: true, tone: "text-foreground" },
      { label: "موظفون غير نشطين", value: cnt(inactive), icon: "UserMinus", int: true, tone: "text-muted-foreground" },
    ];

    return (
      <div className="space-y-6" dir="rtl">
        <ErpPageHeader icon="UsersRound" title="الموارد البشرية" subtitle="نظرة عامة على الموظفين والإجازات والرواتب"
          action={<AcademyLink module="hr" />} />

        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <Card key={k.label}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">{k.label}</div>
                  <Icon name={k.icon} className="size-4 text-muted-foreground" />
                </div>
                <div className={cn("mt-1 text-2xl font-bold tabular-nums", k.tone)}>
                  {k.int ? intf(k.value) : money(k.value)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <NeedsAttention tiles={todos} />

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>الموظفون حسب القسم</CardTitle>
              <CardDescription>الموظفون النشطون فقط.</CardDescription>
            </CardHeader>
            <CardContent>
              {depts.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">لا يوجد موظفون نشطون.</p>
              ) : (
                <div className="space-y-3">
                  {depts.map((d) => (
                    <div key={d.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>{d.name}</span>
                        <span className="tabular-nums text-muted-foreground">{intf(d.n)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max((d.n / maxDept) * 100, 2)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col justify-center">
            <CardContent className="space-y-4 py-8 text-center">
              <div className="text-sm text-muted-foreground">تكلفة الرواتب الشهرية</div>
              <div className="text-4xl font-bold tabular-nums">{money(monthlyCost)}</div>
              <p className="text-xs text-muted-foreground">أساسي + بدلات − خصومات، للموظفين النشطين بأجر شهري (قبل الضريبة).</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>اختصارات</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {SHORTCUTS.map((s) => (
                <Link key={s.href} href={s.href}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:bg-muted">
                  <Icon name={s.icon} className="size-4 text-muted-foreground" />
                  <span className="flex-1">{s.label}</span>
                  {s.key && counts[s.key] > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{intf(counts[s.key])}</span>
                  )}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  });
}
