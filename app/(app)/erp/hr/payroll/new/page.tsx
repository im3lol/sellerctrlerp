import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { NewPayrollRunForm } from "@/components/erp/new-payroll-run-form";

export default async function NewPayrollRunPage() {
  await requireErpModule("hr.view");
  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Banknote" title="مسير رواتب جديد" subtitle="حدد الفترة وسيتم حساب مرتبات الموظفين تلقائيًا." backHref="/erp/hr/payroll" />
      <NewPayrollRunForm />
    </div>
  );
}
