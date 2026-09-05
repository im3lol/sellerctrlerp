import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { employees, users } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CommissionsManager } from "@/components/erp/commissions-manager";

export default async function CommissionsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const reps = await db
      .select({ id: employees.id, fullName: employees.fullName, code: employees.employeeCode, name: users.name })
      .from(employees)
      .leftJoin(users, eq(users.id, employees.userId))
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
      .orderBy(asc(employees.employeeCode));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Percent"
          title="عمولات المبيعات"
          subtitle="محسوبة من الفواتير وسندات القبض — والافتراضي إنها تُستحق لما العميل يدفع"
          backHref="/sales"
        />
        <CommissionsManager
          canManage={can("sales.edit")}
          reps={reps.map((r) => ({ id: r.id, label: `${r.fullName ?? r.name ?? "—"}${r.code ? ` — ${r.code}` : ""}` }))}
        />
      </div>
    );
  });
}
