import { listCloudBackupJobs } from "@/lib/erp/cloud-backup-jobs";
import { CloudBackupJobs } from "@/components/erp/cloud-backup-jobs";
import { formatBackupDate } from "@/lib/erp/backup-date";
import { getPageNotice } from "@/lib/ui-notice";
import { NoticeConsumed } from "@/components/ui/notice-consumed";
import { getT, getLocale } from "@/lib/i18n/server";
import { getActiveOrg, requireErpModule } from "@/lib/erp/org";
import { cloudConnection, driveFolderUrl, googleDriveConfig } from "@/lib/erp/storage-cloud";
import { disconnectGoogleDriveAction, sendGoogleDriveBackupAction, saveGoogleBackupScheduleAction } from "@/app/actions/storage-cloud";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { CloudBackupButton } from "@/components/erp/cloud-backup-button";

export default async function CloudStoragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { orgId } = await requireErpModule("settings.edit");
  const { org, user } = await getActiveOrg();
  const notice = await getPageNotice("/storage/cloud");
  const [t, connection, config, query] = await Promise.all([getT(), cloudConnection(orgId), googleDriveConfig(), searchParams]);
  const [jobs,locale]=await Promise.all([listCloudBackupJobs(orgId),getLocale()]);
  const params = { ...query, ...notice.values };
  const failures: Record<string, string> = {
    "queue": "تعذّر إضافة مهمة النسخ؛ تأكد من اتصال الحساب وتوافر خدمة المهام",
    "readable-partial": "تم حفظ JSON، لكن لم تكتمل جميع ملفات Google Sheets. المجلد يحتوي نسخة جزئية؛ أعد المحاولة لإنشاء نسخة جديدة كاملة.",
    "drive-api": "Google Drive API غير مفعّلة لمشروع المنصة؛ فعّلها من Google Cloud ثم أعد الربط",
    "client-config": "إعدادات تطبيق Google غير صحيحة؛ راجع Client ID وClient Secret وعنوان إعادة التوجيه",
    "reconnect": "تعذّر تأكيد التفويض؛ ابدأ الربط مجددًا ووافق على الوصول لملفات التطبيق",
    "permissions": "صلاحية ملفات Google Drive غير مكتملة؛ أعد الربط ووافق على الصلاحية المطلوبة",
    "quota": "مساحة Google Drive غير كافية؛ وفّر مساحة ثم حاول مجددًا",
    "temporary": "حدث عطل مؤقت في الاتصال بجوجل؛ حاول مجددًا بعد قليل",
  };
  const folderUrl = connection ? driveFolderUrl(connection.folderId) : null;
  return <>
    <NoticeConsumed path={"/storage/cloud"} id={notice.id} />
    <div className="flex items-start gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon name="Cloud" className="size-6" /></span><div><h1 className="text-xl font-bold md:text-2xl">{t("التخزين السحابي")}</h1><p className="mt-1 text-sm text-muted-foreground">{org?.nameAr} · {t("احفظ نسخة إضافية من بيانات مؤسستك في حسابك السحابي")}</p></div></div>
    {(params.connected || params.uploaded || params.disconnected || params.queued || params.scheduleSaved) && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t(params.queued ? "تمت إضافة مهمة النسخ؛ يمكنك متابعة التقدم أدناه" : params.scheduleSaved ? "تم حفظ جدولة النسخ وسياسة الاحتفاظ" : params.uploaded ? "تم حفظ النسخة في مجلد بتاريخها، مع JSON وملفات Google Sheets مستقلة" : params.disconnected ? "تم فصل الحساب؛ الملفات السابقة تظل في حسابك" : "تم ربط Google Drive بالمؤسسة")}</p>}
    {params.error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{t(failures[params.error] ?? (params.error === "limit" ? "وصلت للحد المؤقت لإنشاء النسخ. حاول لاحقًا." : params.error === "config" ? "ربط Google Drive يحتاج تفعيلًا من إدارة المنصة" : params.error === "denied" ? "ليس لديك صلاحية لهذا الإجراء" : params.error === "consent" ? "لم يكتمل التفويض؛ أعد الربط ووافق على صلاحية ملفات التطبيق" : "تعذّر إتمام العملية؛ راجع اتصال الحساب والمساحة المتاحة وحاول مجددًا"))}</p>}
    {params.error === "drive-api" && user?.role === "system_admin" && <Button variant="outline" asChild><a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">{t("تفعيل Google Drive API")}</a></Button>}
    <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-3"><Icon name="HardDrive" className="size-6 text-primary" />Google Drive</CardTitle><span className="rounded-full bg-muted px-3 py-1 text-xs">{t(connection ? "متصل" : "غير متصل")}</span></div><CardDescription>{t("الربط خاص بالمؤسسة الحالية وبصلاحية ملفات التطبيق فقط")}</CardDescription></CardHeader><CardContent className="space-y-5">
      <p className="text-sm leading-7 text-muted-foreground">{t("ينشئ SellerCtrl مجلدًا بتاريخ ووقت النسخة بتوقيت القاهرة، وبداخله ملف JSON للاستعادة وملف Google Sheets مستقل لكل جدول بيانات غير فارغ، مع ملف ملخص. ملفات المرفقات تُحمّل منفصلة، وبيانات التشغيل تظل على خادم النظام.")}</p>
      {!config && <div className="rounded-xl border border-dashed p-4 text-sm">{t("ربط Google Drive يحتاج تفعيلًا من إدارة المنصة")}</div>}
      {connection && <div className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">{t("الحساب المتصل")}</p><p dir="ltr" className="mt-1 break-all text-sm font-medium">{connection.accountEmail}</p></div><div><p className="text-xs text-muted-foreground">{t("آخر نسخة احتياطية (القاهرة)")}</p><p className="mt-1 text-sm font-medium">{connection.lastBackupAt ? formatBackupDate(connection.lastBackupAt,locale) : t("لم تُحفظ نسخة بعد")}</p></div></div>}
      <div className="flex flex-wrap gap-3">
        {config && (connection ? <form action={sendGoogleDriveBackupAction}><CloudBackupButton /></form> : <Button asChild><a href="/api/storage/google/start"><Icon name="Link" className="size-4" />{t("ربط Google Drive")}</a></Button>)}
        {folderUrl && <Button variant="outline" asChild><a href={folderUrl} target="_blank" rel="noopener noreferrer"><Icon name="ExternalLink" className="size-4" />{t("فتح مجلد النسخ")}</a></Button>}
        {connection && <><Button variant="outline" asChild><a href="/api/storage/google/start">{t("إعادة الربط")}</a></Button><form action={disconnectGoogleDriveAction}><Button variant="ghost" type="submit">{t("فصل الحساب")}</Button></form></>}
      </div>
    </CardContent></Card>
    {connection&&<Card><CardHeader><CardTitle>{t("جدولة النسخ والاحتفاظ")}</CardTitle><CardDescription>{t("الجدولة اختيارية، وتعمل يوميًا بعد 03:00 بتوقيت القاهرة")}</CardDescription></CardHeader><CardContent><form action={saveGoogleBackupScheduleAction} className="space-y-4"><label className="flex items-center gap-3 text-sm"><input type="checkbox" name="dailyBackup" defaultChecked={connection.dailyBackup}/>{t("تفعيل النسخ اليومي إلى Google Drive")}</label><label className="block space-y-2 text-sm"><span>{t("عدد النسخ المكتملة للاحتفاظ بها")}</span><select name="retainCopies" defaultValue={connection.retainCopies} className="h-10 w-full rounded-lg border bg-background px-3 sm:max-w-xs">{[0,7,14,30].map(n=><option key={n} value={n}>{n===0?t("الاحتفاظ بكل النسخ"):n}</option>)}</select></label><p className="text-xs leading-6 text-muted-foreground">{t("عند تحديد عدد، تُنقل مجلدات المهام الأقدم المكتملة إلى سلة مهملات Drive. النسخ القديمة خارج هذا السجل لا تتأثر.")}</p><Button type="submit">{t("حفظ إعدادات النسخ")}</Button></form></CardContent></Card>}
    <CloudBackupJobs key={jobs.map(j=>`${j.id}-${j.status}-${j.completedFiles}`).join("|")} initial={jobs}/>
    <Card><CardHeader><CardTitle>{t("خدمات تخزين أخرى")}</CardTitle><CardDescription>{t("الخدمات التالية غير متاحة للربط حاليًا؛ لكل خدمة موصل وتفويض مستقل")}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{["Microsoft OneDrive", "Dropbox"].map(provider => <div key={provider} className="flex items-center gap-3 rounded-xl border p-4"><Icon name="Cloud" className="size-5 text-muted-foreground" /><span className="text-sm font-medium">{provider}</span></div>)}</CardContent></Card>
  </>;
}

