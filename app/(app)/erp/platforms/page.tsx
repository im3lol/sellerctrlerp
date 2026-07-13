import { and, asc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PlatformsManager } from "@/components/erp/platforms-manager";
import { connectableConnectors } from "@/lib/erp/marketplace/registry";

export default async function PlatformsPage() {
  const { orgId, can } = await requireErpModule("sales.view");

  const [rows, whRows, bankRows] = await Promise.all([
    db.select({
      id: salesPlatforms.id,
      name: salesPlatforms.name,
      code: salesPlatforms.code,
      integrationType: salesPlatforms.integrationType,
      productSyncMode: salesPlatforms.productSyncMode,
      syncProducts: salesPlatforms.syncProducts,
      syncOrders: salesPlatforms.syncOrders,
      syncInventory: salesPlatforms.syncInventory,
      isActive: salesPlatforms.isActive,
      customerName: customers.nameAr,
      customerId: salesPlatforms.customerId,
      warehouseId: salesPlatforms.defaultWarehouseId,
      warehouseName: warehouses.nameAr,
      bankAccountId: salesPlatforms.bankAccountId,
      bankName: bankAccounts.nameAr,
    })
      .from(salesPlatforms)
      .leftJoin(customers, eq(customers.id, salesPlatforms.customerId))
      .leftJoin(warehouses, eq(warehouses.id, salesPlatforms.defaultWarehouseId))
      .leftJoin(bankAccounts, eq(bankAccounts.id, salesPlatforms.bankAccountId))
      .where(eq(salesPlatforms.organizationId, orgId))
      .orderBy(asc(salesPlatforms.name)),
    db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
      .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.nameAr)),
    db.select({ id: bankAccounts.id, nameAr: bankAccounts.nameAr }).from(bankAccounts)
      .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.isActive, true))).orderBy(asc(bankAccounts.nameAr)),
  ]);

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Store"
        title="المنصات والقنوات"
        subtitle="أمازون، نون، وغيرها — تربط المبيعات والمخزون والحسابات، وتُدار كلها من هنا"
      />
      <PlatformsManager
        platforms={rows}
        warehouses={whRows}
        bankAccounts={bankRows}
        canManage={can("sales.create")}
        connectors={connectableConnectors().map((c) => ({ code: c.code, label: c.label }))}
      />
    </div>
  );
}
