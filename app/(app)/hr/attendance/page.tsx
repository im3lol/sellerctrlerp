import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AttendanceManager } from "@/components/erp/attendance-manager";

export default async function AttendancePage() {
  return loadErpPage("hr.view", async ({ orgId, can }) => {
    // Only employees with a login can have attendance — the table is keyed by user.
    const staff = await db
      .select({ userId: employees.userId, fullName: employees.fullName, code: employees.employeeCode, name: users.name })
      .from(employees)
      .leftJoin(users, eq(users.id, employees.userId))
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
      .orderBy(asc(employees.employeeCode));

    const options = staff
      .filter((s) => s.userId)
      .map((s) => ({
        userId: s.userId!,
        label: `${s.fullName ?? s.name ?? "—"}${s.code ? ` — ${s.code}` : ""}`,
      }));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Clock"
          title="الحضور والانصراف"
          subtitle="ساعات العمل اللي الرواتب بالساعة بتتحسب منها"
          backHref="/hr"
        />

        {options.length === 0 && (
          <Card><CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              مفيش موظف مربوط بحساب دخول. الحضور بيتسجّل على الحساب، فاربط كل موظف بمستخدم من صفحة الموظفين الأول.
            </p>
          </CardContent></Card>
        )}

        <AttendanceManager staff={options} canEdit={can("hr.create")} />
      </div>
    );
  });
}
