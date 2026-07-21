import { eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { documentPrefixes } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { NumberingForm } from "@/components/erp/numbering-form";

export default async function NumberingSettingsPage() {
  return loadErpPage("settings.view", async ({ orgId, can }) => {
    const rows = await db.select({ docKey: documentPrefixes.docKey, prefix: documentPrefixes.prefix })
      .from(documentPrefixes).where(eq(documentPrefixes.organizationId, orgId));
    const overrides = Object.fromEntries(rows.map((r) => [r.docKey, r.prefix]));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Hash" title="ترقيم المستندات" subtitle="بادئات أرقام الفواتير والسندات وباقي المستندات" backHref="/settings" />
        <NumberingForm overrides={overrides} canEdit={can("settings.edit")} />
      </div>
    );
  });
}
