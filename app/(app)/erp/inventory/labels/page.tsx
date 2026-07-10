import { requireErpModule } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BarcodeLabelsPicker } from "@/components/erp/barcode-labels-picker";

export default async function BarcodeLabelsPage() {
  await requireErpModule("inventory.view");
  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Barcode" title="طباعة ملصقات الباركود" subtitle="اختر أصنافاً وعدد الملصقات لطباعتها دفعة واحدة" backHref="/erp/inventory" />
      <BarcodeLabelsPicker />
    </div>
  );
}
