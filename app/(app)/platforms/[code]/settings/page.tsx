import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PlatformSettingsForm } from "@/components/erp/platform-settings-form";

/** إعدادات المنصة — الصفحة المخصصة بدل الـ dialog المزدحم القديم. */
export default async function PlatformSettingsPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  return loadErpPage("sales.create", async ({ orgId }) => {
    const [[platform], whRows, bankRows] = await Promise.all([
      db.select({
        id: salesPlatforms.id, name: salesPlatforms.name, code: salesPlatforms.code,
        integrationType: salesPlatforms.integrationType, productSyncMode: salesPlatforms.productSyncMode,
        syncProducts: salesPlatforms.syncProducts, syncOrders: salesPlatforms.syncOrders,
        syncInventory: salesPlatforms.syncInventory, syncSettlements: salesPlatforms.syncSettlements,
        autoPostSettlements: salesPlatforms.autoPostSettlements, autoMode: salesPlatforms.autoMode,
        warehouseId: salesPlatforms.defaultWarehouseId, bankAccountId: salesPlatforms.bankAccountId,
        customerName: customers.nameAr,
      })
        .from(salesPlatforms)
        .leftJoin(customers, eq(customers.id, salesPlatforms.customerId))
        .where(and(eq(salesPlatforms.organizationId, orgId), sql`upper(${salesPlatforms.code}) = ${code}`))
        .limit(1),
      db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
        .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.nameAr)),
      db.select({ id: bankAccounts.id, nameAr: bankAccounts.nameAr }).from(bankAccounts)
        .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.isActive, true))).orderBy(asc(bankAccounts.nameAr)),
    ]);
    if (!platform) notFound();

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Settings"
          title={`إعدادات ${platform.name}`}
          subtitle="الهوية · المزامنة · المعالجة التلقائية · الربط المحاسبي"
          backHref={`/platforms/${platform.code.toLowerCase()}`}
        />
        <PlatformSettingsForm platform={platform} warehouses={whRows} bankAccounts={bankRows} />
      </div>
    );
  }, "marketplace");
}
