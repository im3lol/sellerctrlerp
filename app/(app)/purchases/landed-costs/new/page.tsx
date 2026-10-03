import { asc, eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LandedCostForm } from "@/components/erp/landed-cost-form";
import { getLandedCostReceiptsAction } from "@/app/actions/erp/landed-costs";

export default async function NewLandedCostPage() {
  const t = await getT();
  return loadErpPage("purchases.create", async ({ orgId }) => {
    const [supList, receipts] = await Promise.all([
      db.select({ id: suppliers.id, nameAr: suppliers.nameAr }).from(suppliers)
        .where(eq(suppliers.organizationId, orgId)).orderBy(asc(suppliers.code)),
      getLandedCostReceiptsAction(),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Ship"
          title={t("تكاليف استيراد جديدة")}
          subtitle={t("فاتورة شحن/جمارك تصل بعد الاستلام — تُوزَّع على الإذون وتُرفع تكلفة المخزون")}
          backHref="/purchases/landed-costs"
        />
        <LandedCostForm suppliers={supList} receipts={receipts.ok ? (receipts.receipts ?? []) : []} />
      </div>
    );
  });
}
