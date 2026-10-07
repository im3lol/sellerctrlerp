import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { payrollRuns } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PayrollRunsList } from "@/components/erp/payroll-runs-list";

export default async function PayrollPage() {
  const t = await getT();
  return loadErpPage("hr.view", async ({ orgId }) => {
    const runs = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.organizationId, orgId))
      .orderBy(desc(payrollRuns.periodStart));

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Banknote"
          title={t("مسير الرواتب")}
          subtitle={t("معالجة الرواتب الشهرية وترحيل القيود المحاسبية.")}
          action={
            <Link
              href="/hr/payroll/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("+ مسير جديد")}
            </Link>
          }
        />
        <PayrollRunsList runs={runs} />
      </div>
    );
  });
}
