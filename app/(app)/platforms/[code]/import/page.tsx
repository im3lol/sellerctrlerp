import { notFound } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms, marketplaceSettlementTxns } from "@/db/schema";
import type { SettlementRow } from "@/components/erp/settlement-import";
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

    // Recent pulled settlement rows + how many are released-but-unposted (for the
    // manual "post" button). Only for Amazon (the only settlement source today).
    const settlementRows: SettlementRow[] = isAmazon
      ? (await db.select({
          id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type,
          orderId: marketplaceSettlementTxns.orderId, sku: marketplaceSettlementTxns.sku,
          total: marketplaceSettlementTxns.total, status: marketplaceSettlementTxns.status,
          journalEntryId: marketplaceSettlementTxns.journalEntryId,
        }).from(marketplaceSettlementTxns)
          .where(eq(marketplaceSettlementTxns.organizationId, orgId))
          .orderBy(desc(marketplaceSettlementTxns.createdAt)).limit(50))
          .map((r) => ({ id: r.id, type: r.type, orderId: r.orderId, sku: r.sku, total: Number(r.total), status: r.status, posted: !!r.journalEntryId }))
      : [];
    const unpostedReleased = isAmazon
      ? Number((await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
          .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.status, "Released"), isNull(marketplaceSettlementTxns.journalEntryId))))[0]?.n ?? 0)
      : 0;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Upload"
          title={`استيراد — ${platform.name}`}
          subtitle="استيراد الأوامر والمرتجعات والمدفوعات والمخزون للمنصة"
          backHref={`/platforms/${platform.code.toLowerCase()}`}
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
            <TabsContent value="settlement"><SettlementImport code={platform.code} rows={settlementRows} unpostedReleased={unpostedReleased} /></TabsContent>
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
