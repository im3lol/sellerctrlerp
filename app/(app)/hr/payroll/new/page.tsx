import { loadErpPage } from "@/lib/erp/org";
import { getT } from "@/lib/i18n/server";
import { ErpPageHeader } from "@/components/erp/page-header";
import { NewPayrollRunForm } from "@/components/erp/new-payroll-run-form";

export default async function NewPayrollRunPage() {
  const t = await getT();
  return loadErpPage("hr.view", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Banknote" title={t("مسير رواتب جديد")} subtitle={t("حدد الفترة وسيتم حساب مرتبات الموظفين تلقائيًا.")} backHref="/hr/payroll" />
        <NewPayrollRunForm />
      </div>
    );
  });
}
