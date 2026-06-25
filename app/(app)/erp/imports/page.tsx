import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CsvImportClient } from "@/components/erp/csv-import-client";

export default async function ImportsPage() {
  await requireErpModule("sales.view");
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Upload"
        title="استيراد البيانات"
        subtitle="رفع ملف CSV لاستيراد أو تحديث العملاء والأصناف"
      />
      <CsvImportClient />
    </div>
  );
}
