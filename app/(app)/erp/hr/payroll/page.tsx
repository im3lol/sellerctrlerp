import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { payrollRuns } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PayrollRunsList } from "@/components/erp/payroll-runs-list";

export default async function PayrollPage() {
  const { orgId } = await requireErpModule("hr.view");

  const runs = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.organizationId, orgId))
    .orderBy(desc(payrollRuns.periodStart));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Banknote"
        title="مسير الرواتب"
        subtitle="معالجة الرواتب الشهرية وترحيل القيود المحاسبية."
        action={
          <Link
            href="/erp/hr/payroll/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + مسير جديد
          </Link>
        }
      />
      <PayrollRunsList runs={runs} />
    </div>
  );
}
