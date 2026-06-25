import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { payrollRuns, payrollLines, employees, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PayrollRunDetail } from "@/components/erp/payroll-run-detail";

export default async function PayrollRunPage({ params }: { params: { id: string } }) {
  const { orgId } = await requireErpModule("hr.view");

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, params.id), eq(payrollRuns.organizationId, orgId)))
    .limit(1);

  if (!run) notFound();

  const lines = await db
    .select({
      id: payrollLines.id,
      employeeId: payrollLines.employeeId,
      userId: payrollLines.userId,
      basicSalary: payrollLines.basicSalary,
      allowances: payrollLines.allowances,
      grossPay: payrollLines.grossPay,
      deductions: payrollLines.deductions,
      taxAmount: payrollLines.taxAmount,
      netPay: payrollLines.netPay,
      hoursWorked: payrollLines.hoursWorked,
      notes: payrollLines.notes,
      userName: users.name,
      position: employees.position,
      department: employees.department,
    })
    .from(payrollLines)
    .leftJoin(users, eq(payrollLines.userId, users.id))
    .leftJoin(employees, eq(payrollLines.employeeId, employees.id))
    .where(eq(payrollLines.payrollRunId, run.id))
    .orderBy(users.name);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Banknote"
        title={`مسير الرواتب — ${run.number}`}
        subtitle={`الفترة: ${new Date(run.periodStart).toLocaleDateString("ar-EG")} — ${new Date(run.periodEnd).toLocaleDateString("ar-EG")}`}
        backHref="/erp/hr/payroll"
      />
      <PayrollRunDetail run={run} lines={lines} />
    </div>
  );
}
