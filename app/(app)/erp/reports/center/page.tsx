import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReportGenerator } from "@/components/erp/report-generator";

export default async function ReportsCenterPage() {
  // Guard only — the generator is a self-contained client wizard.
  return loadErpPage("reports.view", async () => (
    <div className="mx-auto max-w-4xl space-y-6">
      <ErpPageHeader icon="ChartColumn" title="مركز التقارير" subtitle="اختر الموديول ثم التقرير والفترة والصيغة — واستخرجه PDF أو Excel" />
      <ReportGenerator />
    </div>
  ));
}
