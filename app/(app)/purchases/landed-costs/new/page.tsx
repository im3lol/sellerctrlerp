import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LandedCostForm } from "@/components/erp/landed-cost-form";
import { getLandedCostReceiptsAction } from "@/app/actions/erp/landed-costs";

export default async function NewLandedCostPage() {
  return loadErpPage("purchases.create", async () => {
    const receipts = await getLandedCostReceiptsAction();

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Ship"
          title="تكاليف استيراد جديدة"
          subtitle="فاتورة شحن/جمارك تصل بعد الاستلام — تُوزَّع على الإذون وتُرفع تكلفة المخزون"
          backHref="/purchases/landed-costs"
        />
        <LandedCostForm receipts={receipts.ok ? (receipts.receipts ?? []) : []} />
      </div>
    );
  });
}
