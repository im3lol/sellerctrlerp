import { eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { resolvePrintSettings } from "@/lib/erp/print-settings";
import { PrintSettingsForm, type PrintOrgInfo } from "@/components/erp/print-settings-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { isQzConfigured } from "@/lib/erp/qz-sign";

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

        {isQzConfigured() && (
          <Card>
            <CardHeader>
              <CardTitle>شهادة طباعة الباركود (QZ Tray)</CardTitle>
              <CardDescription>لمنع ظهور نافذة &quot;Allow&quot; من QZ Tray عند كل طباعة ملصقات، حمّل الشهادة وأضفها مرة واحدة على كل جهاز هيطبع.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                <li>حمّل ملف الشهادة بالزرار تحت.</li>
                <li>افتح أيقونة QZ Tray في شريط المهام ← Advanced ← Site Manager.</li>
                <li>في تبويب Allowed دوس على &quot;+&quot; واختَر الملف اللي نزّلته.</li>
                <li>ارجع لصفحة طباعة الملصقات — النافذة مش هتظهر تاني.</li>
              </ol>
              <Button asChild variant="outline">
                <a href="/api/erp/qz/cert" download="sellerctrl-qz-certificate.txt">
                  <Download className="size-4" />تحميل شهادة الطباعة
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  });
}
