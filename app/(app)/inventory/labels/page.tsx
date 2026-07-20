import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BarcodeLabelsPicker } from "@/components/erp/barcode-labels-picker";

export default async function BarcodeLabelsPage() {
  return loadErpPage("inventory.view", async () => {
    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Barcode" title="طباعة ملصقات الباركود" subtitle="اختر أصنافاً وعدد الملصقات لطباعتها دفعة واحدة" backHref="/inventory" />
        <BarcodeLabelsPicker />
      </div>
    );
  });
}
