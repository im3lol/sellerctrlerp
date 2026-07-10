import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, organizations, holidays } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LeaveRequestForm } from "@/components/erp/leave-request-form";

export default async function NewLeaveRequestPage() {
  const { orgId } = await requireErpModule("hr.create");
  const [emps, org, holis] = await Promise.all([
    db.select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode }).from(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))).orderBy(asc(employees.employeeCode)),
    db.select({ nameAr: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1),
    db.select({ date: holidays.date }).from(holidays).where(eq(holidays.organizationId, orgId)),
  ]);
  const empOptions = emps.map((e) => ({ id: e.id, label: e.fullName || e.code || "موظف" }));
  const holidayDates = holis.map((h) => new Date(h.date).toISOString().slice(0, 10));
  return (
    <div className="space-y-6">
      <ErpPageHeader icon="CalendarDays" title="طلب إجازة جديد" subtitle="طلب إجازة موظف — يُعتمد أو يُرفض" backHref="/erp/hr/leaves" />
      <LeaveRequestForm employees={empOptions} orgName={org[0]?.nameAr ?? "—"} holidays={holidayDates} />
    </div>
  );
}
