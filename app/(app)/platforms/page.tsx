import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts, platformCredentials } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PlatformsManager } from "@/components/erp/platforms-manager";
import { registeredConnectors } from "@/lib/erp/marketplace/registry";
import { enabledConnectorCodes } from "@/lib/saas/connector-enabled";

export default async function PlatformsPage() {
  return loadErpPage("sales.view", async ({ orgId, can }) => {
    const enabled = await enabledConnectorCodes();
    const [rows, whRows, bankRows] = await Promise.all([
      db.select({
        id: salesPlatforms.id,
        name: salesPlatforms.name,
        code: salesPlatforms.code,
        integrationType: salesPlatforms.integrationType,
        isActive: salesPlatforms.isActive,
        customerName: customers.nameAr,
        warehouseName: warehouses.nameAr,
        bankName: bankAccounts.nameAr,
        credentialAt: platformCredentials.connectedAt,
        lastSync: platformCredentials.lastSyncAt,
      })
        .from(salesPlatforms)
        .leftJoin(customers, eq(customers.id, salesPlatforms.customerId))
        .leftJoin(warehouses, eq(warehouses.id, salesPlatforms.defaultWarehouseId))
        .leftJoin(bankAccounts, eq(bankAccounts.id, salesPlatforms.bankAccountId))
        // Connection status: a credential row for this org whose provider = the platform code.
        .leftJoin(platformCredentials, and(
          eq(platformCredentials.organizationId, salesPlatforms.organizationId),
          sql`${platformCredentials.provider} = lower(${salesPlatforms.code})`,
        ))
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
          platforms={rows.map((r) => ({
            id: r.id, name: r.name, code: r.code, integrationType: r.integrationType, isActive: r.isActive,
            customerName: r.customerName, warehouseName: r.warehouseName, bankName: r.bankName,
            connected: !!r.credentialAt,
            lastSyncAt: r.lastSync ? new Date(r.lastSync).toISOString() : null,
          }))}
          warehouses={whRows}
          bankAccounts={bankRows}
          canManage={can("sales.create")}
          connectors={registeredConnectors().filter((c) => enabled.has(c.code)).map((c) => ({ code: c.code, label: c.label }))}
        />
      </div>
    );
  }, "marketplace");
}
