import { eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { EmployeesManager } from "@/components/erp/employees-manager";

export default async function EmployeesPage() {
  const { orgId } = await requireErpModule("hr.view");

  // Every active user can be made an employee (adding their payroll data also
  // adds them to the org). Left-join their employee record for this org.
  const [userRows, empRows] = await Promise.all([
    db.select({ userId: users.id, name: users.name, email: users.email, title: users.title, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.isActive, true))
      .orderBy(users.name),
    db.select().from(employees).where(eq(employees.organizationId, orgId)),
  ]);

  const empByUserId = new Map(empRows.filter((e) => e.userId).map((e) => [e.userId, e]));
  const list = [
    // Users (each can be onboarded as an employee)
    ...userRows.map((u) => ({ userId: u.userId as string | null, name: u.name, email: u.email, title: u.title, employee: empByUserId.get(u.userId) ?? null })),
    // Payroll-only employees with no system user
    ...empRows.filter((e) => !e.userId).map((e) => ({ userId: null, name: e.fullName ?? "—", email: null, title: e.position, employee: e })),
  ];

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="UserCog" title="الموظفون" subtitle="أضف أي مستخدم كموظف بإعداد بيانات راتبه." />
      <EmployeesManager members={list} orgId={orgId} />
    </div>
  );
}
