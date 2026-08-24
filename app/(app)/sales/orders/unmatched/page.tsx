import { ErpPageHeader } from "@/components/erp/page-header";
import { getUnmatchedOrders } from "@/app/actions/erp/unmatched-orders";
import { UnmatchedOrdersClient } from "@/components/erp/unmatched-orders-client";

export const dynamic = "force-dynamic";

// Marketplace orders parked because their product isn't linked to any item. The seller
// creates the product (+ its platform codes) then the order manually — no auto-create.
export default async function UnmatchedOrdersPage() {
  const orders = await getUnmatchedOrders();
  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="PackageX"
        title="طلبات بمنتج غير معرَّف"
        subtitle="طلبات وصلت من المنصات ومنتجها مش مربوط بأي صنف — تحتاج إنشاء المنتج + الطلب يدويًا"
        backHref="/sales/orders"
      />
      <UnmatchedOrdersClient initial={orders} />
    </div>
  );
}
