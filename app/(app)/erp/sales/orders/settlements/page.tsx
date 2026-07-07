import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SettlementImport } from "@/components/erp/settlement-import";

export default async function AmazonSettlementsPage() {
  await requireErpModule("accounting.create");
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Landmark"
        title="تسويات أمازون"
        subtitle="استيراد تقرير المعاملات وترحيل الرسوم والصافي محاسبياً"
        backHref="/erp/sales/orders"
      />
      <SettlementImport />
    </div>
  );
}
