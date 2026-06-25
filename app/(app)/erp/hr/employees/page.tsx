import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, organizationMembers, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { EmployeesManager } from "@/components/erp/employees-manager";

export default async function EmployeesPage() {
  const { orgId } = await requireErpModule("hr.view");

  // All org members with their employee record (if any)
  const members = await db
    .select({
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      name: users.name,
      email: users.email,
      title: users.title,
      avatarUrl: users.avatarUrl,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(eq(organizationMembers.organizationId, orgId));

  const empRows = await db
    .select()
    .from(employees)
    .where(eq(employees.organizationId, orgId));

  const empByUserId = new Map(empRows.map((e) => [e.userId, e]));

  const list = members.map((m) => ({
    ...m,
    employee: empByUserId.get(m.userId as string) ?? null,
  }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="UserCog" title="الموظفون" subtitle="إدارة بيانات الرواتب لأعضاء المؤسسة." />
      <EmployeesManager members={list} orgId={orgId} />
    </div>
  );
}
