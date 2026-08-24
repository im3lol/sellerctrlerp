import { ErpPageHeader } from "@/components/erp/page-header";
import { loadErpPage } from "@/lib/erp/org";
import { getPlatformRemovals } from "@/lib/erp/removals-core";
import { MarketplaceRemovalsClient } from "@/components/erp/marketplace-removals-client";

export const dynamic = "force-dynamic";

// Amazon removal orders (stock out of the FBA warehouse) awaiting the trader's decision:
// received back → restock, or disposed by Amazon → write-off. Not a customer return.
export default async function MarketplaceRemovalsPage() {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const rows = await getPlatformRemovals(orgId);
    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="PackageX"
          title="أوامر السحب (Removal)"
          subtitle="مخزون طلعته المنصة من مخزنها — أكّد إنك استلمته (إرجاع للمخزن) أو اتلف (إهلاك). مش مرتجع عميل."
          backHref="/sales/marketplace-returns"
        />
        <MarketplaceRemovalsClient initial={rows} />
      </div>
    );
  });
}
