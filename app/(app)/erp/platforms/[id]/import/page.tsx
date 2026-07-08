import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PlatformImport } from "@/components/erp/platform-import";
import { AmazonImport } from "@/components/erp/amazon-import";

export default async function PlatformImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId } = await requireErpModule("sales.create");

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, orgId))).limit(1);
  if (!platform) notFound();

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="Upload"
        title={`استيراد — ${platform.name}`}
        subtitle="رفع ملف الأوامر وإنشاء أوامر بيع للمنصة"
        backHref="/erp/platforms"
      />
      {platform.integrationType === "amazon"
        ? <AmazonImport />
        : <PlatformImport platformId={platform.id} platformName={platform.name} />}
    </div>
  );
}
