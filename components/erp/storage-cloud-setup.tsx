import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { withPlatformScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { platformIntegrations } from "@/db/schema";
import { cloudCallbackUrl, DRIVE_CONFIG } from "@/lib/erp/storage-cloud";
import { saveGoogleDriveConfigAction } from "@/app/actions/storage-cloud";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { SettingsTile } from "@/components/admin/settings-tile";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export async function StorageCloudSetup({ source = "storage", defaultOpen = false }: { source?: "storage" | "admin-integrations"; defaultOpen?: boolean } = {}) {
  if ((await getCurrentUser())?.role !== "system_admin") return null;
  const t = await getT();
  const [config] = await withPlatformScope(() => db.select({ clientId: platformIntegrations.clientId, secret: platformIntegrations.clientSecret }).from(platformIntegrations).where(eq(platformIntegrations.code, DRIVE_CONFIG)).limit(1));
  const configured = !!(config?.clientId || process.env.GOOGLE_DRIVE_CLIENT_ID) && !!(config?.secret || process.env.GOOGLE_DRIVE_CLIENT_SECRET);
  const fields = <div className="space-y-4">
    {defaultOpen && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{t("راجع Client ID وClient Secret وأعد المحاولة")}</p>}
    <form action={saveGoogleDriveConfigAction} className="space-y-4">
      <input type="hidden" name="source" value={source} />
      <div className="space-y-2"><Label htmlFor="drive-client">Client ID</Label><Input id="drive-client" name="clientId" dir="ltr" required defaultValue={config?.clientId || process.env.GOOGLE_DRIVE_CLIENT_ID || ""} autoComplete="off" /></div>
      <div className="space-y-2"><Label htmlFor="drive-secret">Client Secret</Label><Input id="drive-secret" name="clientSecret" type="password" dir="ltr" autoComplete="new-password" required={!config?.secret && !process.env.GOOGLE_DRIVE_CLIENT_SECRET} placeholder={t("اتركه فارغًا للاحتفاظ بالسر الحالي")} /></div>
      <p className="text-xs text-muted-foreground">{t("السر يُحفظ مشفرًا ولا يظهر للمستخدمين؛ لا ترسله في الشات")}</p>
      <Button type="submit">{t("حفظ إعداد الربط")}</Button>
    </form>
    <div className="space-y-2 border-t pt-4"><p className="text-xs font-medium">Redirect URI</p><code dir="ltr" className="block break-all rounded-lg border bg-muted/40 p-3 text-xs">{cloudCallbackUrl()}</code></div>
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium text-primary">{t("إعداد Google Drive للمنصة")}</summary>
      <div className="mt-3 space-y-3">
        <ol className="list-inside list-decimal space-y-2 text-xs leading-6 text-muted-foreground">
          <li>{t("أنشئ مشروعًا في Google Cloud وفعّل Google Drive API")}</li>
          <li>{t("جهّز Google Auth Platform باسم SellerCtrl، وأضف بريد الدعم وروابط الصفحة الرئيسية والخصوصية والدومين sellerctrl.com")}</li>
          <li>{t("اختر External وأضف صلاحية drive.file فقط. أثناء الاختبار أضف بريدك ضمن Test users")}</li>
          <li>{t("أنشئ OAuth Client من نوع Web application وأضف عنوان إعادة التوجيه التالي كما هو")}</li>
        </ol>
        <p className="text-xs leading-6 text-muted-foreground">{t("لإتاحة الربط لكل العملاء انشر تطبيق Google للإنتاج وأكمل متطلبات التحقق التي يعرضها Google؛ وضع الاختبار قد يوقف التفويض بعد 7 أيام")}</p>
        <div className="flex flex-wrap gap-3 text-xs text-primary"><a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console ↗</a><a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth" target="_blank" rel="noopener noreferrer">{t("دليل صلاحيات Google Drive")}</a></div>
      </div>
    </details>
  </div>;
  if (source === "admin-integrations") return <div id="google-drive" className="min-w-0 [&>button]:w-full"><SettingsTile label="Google Drive" icon="HardDrive" brandCls="bg-emerald-500/15 text-emerald-600" configured={configured} defaultOpen={defaultOpen} dialogTitle={t("إعداد Google Drive للمنصة")} dialogDescription={t("إعداد واحد للمنصة؛ كل مؤسسة توافق على ربط حسابها بنفسها")}>{fields}</SettingsTile></div>;
  return <Card id="google-drive"><CardHeader><CardTitle>{t("إعداد Google Drive للمنصة")}</CardTitle><CardDescription>{t("إعداد واحد للمنصة؛ كل مؤسسة توافق على ربط حسابها بنفسها")}</CardDescription></CardHeader><CardContent>{fields}</CardContent></Card>;
}
