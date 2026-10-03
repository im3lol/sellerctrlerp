import { eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
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
  const t = await getT();
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
        <ErpPageHeader icon="Printer" title={t("إعدادات الطباعة")} subtitle={t("ترويسة المطبوعات والأعمدة الظاهرة في كل وثيقة")} backHref="/settings" />
        <PrintSettingsForm org={org} settings={resolvePrintSettings(row?.printSettings)} canEdit={can("settings.edit")} />

        {isQzConfigured() && (
          <Card>
            <CardHeader>
              <CardTitle>{t("شهادة طباعة الباركود (QZ Tray)")}</CardTitle>
              <CardDescription>{t("لمنع ظهور نافذة \"Allow\" من QZ Tray عند كل طباعة ملصقات، حمّل الشهادة وأضفها مرة واحدة على كل جهاز هيطبع.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                <li>{t("حمّل ملف الشهادة بالزرار تحت.")}</li>
                <li>{t("افتح أيقونة QZ Tray في شريط المهام ← Advanced ← Site Manager.")}</li>
                <li>{t("في تبويب Allowed دوس على \"+\" واختَر الملف اللي نزّلته.")}</li>
                <li>{t("ارجع لصفحة طباعة الملصقات — النافذة مش هتظهر تاني.")}</li>
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
