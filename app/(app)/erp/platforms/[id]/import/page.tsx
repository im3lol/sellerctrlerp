import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlatformImport } from "@/components/erp/platform-import";
import { PlatformPaymentsImport } from "@/components/erp/platform-payments-import";
import { PlatformInventoryImport } from "@/components/erp/platform-inventory-import";
import { AmazonImport } from "@/components/erp/amazon-import";
import { SettlementImport } from "@/components/erp/settlement-import";

const soon = (msg: string) => (
  <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{msg}</div>
);

export default async function PlatformImportPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const { orgId } = await requireErpModule("sales.create");

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, orgId))).limit(1);
  if (!platform) notFound();

  const isAmazon = platform.integrationType === "amazon";
  const allowed = isAmazon ? ["orders", "settlement", "inventory"] : ["orders", "payments", "returns", "inventory"];
  const defaultTab = tab && allowed.includes(tab) ? tab : "orders";

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Upload"
        title={`استيراد — ${platform.name}`}
        subtitle="استيراد الأوامر والمرتجعات والمدفوعات والمخزون للمنصة"
        backHref={`/erp/platforms/${platform.id}`}
      />

      {isAmazon ? (
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="orders">مبيعات</TabsTrigger>
            <TabsTrigger value="settlement">تسويات (مرتجعات + مدفوعات + عمولات)</TabsTrigger>
            <TabsTrigger value="inventory">مخزون</TabsTrigger>
          </TabsList>
          <TabsContent value="orders"><AmazonImport /></TabsContent>
          <TabsContent value="settlement"><SettlementImport /></TabsContent>
          <TabsContent value="inventory"><PlatformInventoryImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="orders">مبيعات</TabsTrigger>
            <TabsTrigger value="payments">مدفوعات</TabsTrigger>
            <TabsTrigger value="returns">مرتجعات</TabsTrigger>
            <TabsTrigger value="inventory">مخزون</TabsTrigger>
          </TabsList>
          <TabsContent value="orders"><PlatformImport platformId={platform.id} platformName={platform.name} /></TabsContent>
          <TabsContent value="payments"><PlatformPaymentsImport platformId={platform.id} platformName={platform.name} hasBank={!!platform.bankAccountId} /></TabsContent>
          <TabsContent value="returns">{soon("استيراد المرتجعات للمنصات العامة قريبًا. لأمازون تُعالَج ضمن التسويات.")}</TabsContent>
          <TabsContent value="inventory"><PlatformInventoryImport platformId={platform.id} platformName={platform.name} hasWarehouse={!!platform.defaultWarehouseId} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
