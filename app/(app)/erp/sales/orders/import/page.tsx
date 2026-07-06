import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AmazonImport } from "@/components/erp/amazon-import";

export default async function ImportAmazonOrdersPage() {
  await requireErpModule("sales.create");
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Upload"
        title="استيراد طلبات أمازون"
        subtitle="رفع تقرير الطلبات وإنشاء أوامر بيع"
        backHref="/erp/sales/orders"
      />
      <AmazonImport />
    </div>
  );
}
