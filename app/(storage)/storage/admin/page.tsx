import { getPageNotice } from "@/lib/ui-notice";
import { NoticeConsumed } from "@/components/ui/notice-consumed";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { withPlatformScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { openStorageOrgAction } from "@/app/actions/storage-portal";
import SystemPage from "@/app/(admin)/admin/system/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StorageCloudSetup } from "@/components/erp/storage-cloud-setup";

export default async function StorageAdminPage({ searchParams }: { searchParams: Promise<{ cloudSaved?: string; cloudError?: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") redirect("/storage");
  const t = await getT();
  const notice = await getPageNotice("/storage/admin");
  const params = { ...await searchParams, ...notice.values };
  const rows = await withPlatformScope(async () => (await db.execute<{ id: string; name: string; files: number; bytes: string; backups: number }>(sql`
    select o.id, o.name_ar as name,
      (select count(*)::int from document_attachments a where a.organization_id=o.id) as files,
      (select coalesce(sum(a.file_size),0)::text from document_attachments a where a.organization_id=o.id) as bytes,
      (select count(*)::int from backup_runs b where b.organization_id=o.id) as backups
    from organizations o order by o.created_at desc
  `)).rows);
  return <>
    <NoticeConsumed path={"/storage/admin"} id={notice.id} />
    <div><h1 className="text-2xl font-bold">{t("المؤسسات وموارد النظام")}</h1><p className="mt-1 text-muted-foreground">{t("إدارة ملفات المؤسسات ونسخها ومتابعة موارد الخادم")}</p></div>
    <Card><CardHeader><CardTitle>{t("المؤسسات")}</CardTitle></CardHeader><CardContent className="divide-y">
      {rows.map(o => <div key={o.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><p className="font-semibold">{o.name}</p><p className="text-sm text-muted-foreground">{o.files} {t("ملف")} · {(Number(o.bytes) / 1024 / 1024).toFixed(2)} MB · {o.backups} {t("نسخة محفوظة")}</p></div><form action={openStorageOrgAction.bind(null, o.id)}><button className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted">{t("فتح ملفات المؤسسة")}</button></form></div>)}
    </CardContent></Card>
    <SystemPage />
    {params.cloudSaved && <p role="status" className="rounded-xl border p-4 text-sm">{t("تم حفظ إعداد Google Drive")}</p>}
    {params.cloudError && <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">{t("راجع Client ID وClient Secret وأعد المحاولة")}</p>}
    <StorageCloudSetup />
  </>;
}
