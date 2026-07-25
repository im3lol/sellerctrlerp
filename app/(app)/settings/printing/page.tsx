import { eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { resolvePrintSettings } from "@/lib/erp/print-settings";
import { PrintSettingsForm, type PrintOrgInfo } from "@/components/erp/print-settings-form";

export default async function PrintingSettingsPage() {
  return loadErpPage("settings.view", async ({ orgId, can }) => {
    const [row] = await db
      .select({
        nameAr: organizations.nameAr,
        address: organizations.address,
        phone: organizations.phone,
        taxNumber: organizations.taxNumber,
        logo: organizations.logo,
        printSettings: organizations.printSettings,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    const org: PrintOrgInfo = {
      nameAr: row?.nameAr ?? "",
      address: row?.address ?? null,
      phone: row?.phone ?? null,
      taxNumber: row?.taxNumber ?? null,
      logo: row?.logo ?? null,
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Printer" title="إعدادات الطباعة" subtitle="ترويسة المطبوعات والأعمدة الظاهرة في كل وثيقة" backHref="/settings" />
        <PrintSettingsForm org={org} settings={resolvePrintSettings(row?.printSettings)} canEdit={can("settings.edit")} />
      </div>
    );
  });
}
