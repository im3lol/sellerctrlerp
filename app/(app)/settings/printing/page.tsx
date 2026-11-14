import { LabelPrinterSetup } from "@/components/erp/label-printer-setup";
import { eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { resolvePrintSettings } from "@/lib/erp/print-settings";
import { PrintSettingsForm, type PrintOrgInfo } from "@/components/erp/print-settings-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";




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
        <LabelPrinterSetup />
        <PrintSettingsForm org={org} settings={resolvePrintSettings(row?.printSettings)} canEdit={can("settings.edit")} />

        <Card>
          <CardHeader>
            <CardTitle>{t("طباعة الملصقات من المتصفح")}</CardTitle>
            <CardDescription>{t("نافذة واحدة للدفعة كاملة، بدون QZ Tray أو برامج إضافية للطباعة.")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
              <li>{t("ثبّت تعريف الطابعة على جهازك، ثم اخترها من نافذة الطباعة؛ تعمل طابعات USB والشبكة عبر تعريف النظام.")}</li>
              <li>{t("حدد الأصناف والأكواد والكميات، ثم اضغط طباعة لفتح نافذة واحدة لجميع الملصقات.")}</li>
              <li>{t("اختر المقاس المحفوظ في المعايرة وقياس 100%، وأوقف الترويسات والتذييلات والهوامش من إعدادات الطباعة.")}</li>
              <li>{t("جرّب ملصقًا واحدًا عند إعداد طابعة جديدة، ثم اطبع الدفعة كاملة.")}</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    );
  });
}
