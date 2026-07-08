import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PlatformImport } from "@/components/erp/platform-import";
import { PlatformPaymentsImport } from "@/components/erp/platform-payments-import";
import { AmazonImport } from "@/components/erp/amazon-import";
import { SettlementImport } from "@/components/erp/settlement-import";

export default async function PlatformImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireErpModule("sales.create");

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, orgId))).limit(1);
  if (!platform) notFound();

  const isAmazon = platform.integrationType === "amazon";

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Upload"
        title={`استيراد — ${platform.name}`}
        subtitle="استيراد الأوامر والمرتجعات والمدفوعات والتسويات للمنصة"
        backHref="/erp/platforms"
      />

      {isAmazon ? (
        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">الأوامر (المبيعات)</TabsTrigger>
            <TabsTrigger value="settlement">التسويات (مرتجعات + مدفوعات + عمولات)</TabsTrigger>
          </TabsList>
          <TabsContent value="orders"><AmazonImport /></TabsContent>
          <TabsContent value="settlement"><SettlementImport /></TabsContent>
        </Tabs>
      ) : (
        <Tabs defaultValue="orders">
          <TabsList>
            <TabsTrigger value="orders">الأوامر (المبيعات)</TabsTrigger>
            <TabsTrigger value="payments">المدفوعات</TabsTrigger>
            <TabsTrigger value="returns">المرتجعات</TabsTrigger>
          </TabsList>
          <TabsContent value="orders"><PlatformImport platformId={platform.id} platformName={platform.name} /></TabsContent>
          <TabsContent value="payments"><PlatformPaymentsImport platformId={platform.id} platformName={platform.name} hasBank={!!platform.bankAccountId} /></TabsContent>
          <TabsContent value="returns">
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              استيراد المرتجعات للمنصات العامة قريبًا. لأمازون، تُعالَج المرتجعات تلقائيًا ضمن تقرير التسويات.
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
