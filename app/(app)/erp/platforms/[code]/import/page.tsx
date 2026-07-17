import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlatformImport } from "@/components/erp/platform-import";
import { PlatformPaymentsImport } from "@/components/erp/platform-payments-import";
import { PlatformReturnsImport } from "@/components/erp/platform-returns-import";
import { PlatformInventoryImport } from "@/components/erp/platform-inventory-import";
import { PlatformRemovalsImport } from "@/components/erp/platform-removals-import";
import { AmazonImport } from "@/components/erp/amazon-import";
import { SettlementImport } from "@/components/erp/settlement-import";

export default async function PlatformImportPage({
  params, searchParams,
}: { params: Promise<{ code: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { code: codeParam } = await params;
  const { tab } = await searchParams;
  return loadErpPage("sales.create", async ({ orgId }) => {
    const [platform] = await db.select().from(salesPlatforms)
      .where(and(eq(salesPlatforms.code, codeParam.toUpperCase()), eq(salesPlatforms.organizationId, orgId))).limit(1);
    if (!platform) notFound();

    const isAmazon = platform.integrationType === "amazon";
    const allowed = isAmazon ? ["orders", "settlement", "inventory", "removals"] : ["orders", "payments", "returns", "inventory", "removals"];
    const defaultTab = tab && allowed.includes(tab) ? tab : "orders";

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Upload"
          title={`استيراد — ${platform.name}`}
          subtitle="استيراد الأوامر والمرتجعات والمدفوعات والمخزون للمنصة"
          backHref={`/erp/platforms/${platform.code.toLowerCase()}`}
        />

        {isAmazon ? (
          <Tabs defaultValue={defaultTab}>
            <TabsList>
              <TabsTrigger value="orders">مبيعات</TabsTrigger>
              <TabsTrigger value="settlement">تسويات (مرتجعات + مدفوعات + عمولات)</TabsTrigger>
              <TabsTrigger value="inventory">مخزون</TabsTrigger>
              <TabsTrigger value="removals">إزالات</TabsTrigger>
            </TabsList>
            <TabsContent value="orders"><AmazonImport /></TabsContent>
            <TabsContent value="settlement"><SettlementImport /></TabsContent>
            <TabsContent value="inventory"><PlatformInventoryImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
            <TabsContent value="removals"><PlatformRemovalsImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
          </Tabs>
        ) : (
          <Tabs defaultValue={defaultTab}>
            <TabsList>
              <TabsTrigger value="orders">مبيعات</TabsTrigger>
              <TabsTrigger value="payments">مدفوعات</TabsTrigger>
              <TabsTrigger value="returns">مرتجعات</TabsTrigger>
              <TabsTrigger value="inventory">مخزون</TabsTrigger>
              <TabsTrigger value="removals">إزالات</TabsTrigger>
            </TabsList>
            <TabsContent value="orders"><PlatformImport platformId={platform.id} platformName={platform.name} /></TabsContent>
            <TabsContent value="payments"><PlatformPaymentsImport platformId={platform.id} platformName={platform.name} hasBank={!!platform.bankAccountId} /></TabsContent>
            <TabsContent value="returns"><PlatformReturnsImport platformId={platform.id} platformName={platform.name} /></TabsContent>
            <TabsContent value="inventory"><PlatformInventoryImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
            <TabsContent value="removals"><PlatformRemovalsImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
          </Tabs>
        )}
      </div>
    );
  }, "marketplace");
}
