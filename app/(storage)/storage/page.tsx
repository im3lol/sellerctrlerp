import { formatBackupDate } from "@/lib/erp/backup-date";
import { getPageNotice } from "@/lib/ui-notice";
import { NoticeConsumed } from "@/components/ui/notice-consumed";
import Link from "next/link";
import { and, asc, desc, eq, ilike, isNotNull, ne, not, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentAttachments, items, organizationBackupHealth } from "@/db/schema";
import { withOrgScope } from "@/lib/db-scope";
import { getActiveOrg } from "@/lib/erp/org";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getEnabledModules, moduleOfPermission } from "@/lib/erp/entitlements";
import { ATTACHMENT_POLICIES } from "@/lib/erp/attachment-policy";
import { EXPORT_DATASETS, EXPORT_ORDER } from "@/lib/erp/export-datasets";
import { canExportDataset } from "@/lib/erp/data-access";
import { listBackups } from "@/lib/erp/backup";
import { createStorageBackupAction } from "@/app/actions/storage-portal";
import { StorageBackupButton } from "@/components/erp/storage-backup-button";
import { DatasetExport } from "@/components/erp/dataset-export";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getLocale, getT } from "@/lib/i18n/server";
import type { ErpPermission } from "@/lib/erp/permissions";
import { Icon } from "@/components/icon";
import { itemMatches } from "@/lib/erp/item-match";

export default async function StoragePage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string; created?: string; error?: string }> }) {
  const notice = await getPageNotice("/storage");
  const params = { ...await searchParams, ...notice.values };
  const { user, org } = await getActiveOrg();
  const t = await getT();
  const locale = await getLocale();
  if (!user || !org) return <Card><CardContent className="py-8">{t("لا توجد مؤسسة مرتبطة بحسابك. تواصل مع مدير المؤسسة.")}</CardContent></Card>;
  const access = await getMemberAccess(org.id, user);
  const enabled = await withOrgScope(org.id, false, () => getEnabledModules(org.id));
  const can = (p: ErpPermission) => access.permissions.has(p) && (user.role === "system_admin" || moduleOfPermission(p) === "settings" || enabled.has(moduleOfPermission(p)));
  const manage = can("settings.edit");
  const date = (d: Date) => formatBackupDate(d,locale);
  const bytes = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const view = ["files", "images", "data"].includes(params.view ?? "") ? params.view : "backups";
  const exports = EXPORT_ORDER.filter(key => canExportDataset(EXPORT_DATASETS[key], can));
  return <>
    <NoticeConsumed path={"/storage"} id={notice.id} />
    <div className="flex items-start gap-3"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon name={view === "files" ? "FolderOpen" : view === "images" ? "Images" : view === "data" ? "Table2" : "DatabaseBackup"} className="size-6" /></span><div><h1 className="text-xl font-bold md:text-2xl">{t(view === "files" ? "ملفات المؤسسة" : view === "images" ? "صور الأصناف" : view === "data" ? "تنزيل الجداول" : "النسخ الاحتياطي")}</h1><p className="mt-1 text-sm text-muted-foreground">{org.nameAr} · {t("ملفات مؤسستك ونسخها الاحتياطية في مكان واحد")}</p></div></div>
    {params.created === "1" && <p role="status" className="rounded-lg border bg-background p-4">{t("تم حفظ النسخة الاحتياطية بنجاح")}</p>}
    {params.error && <p role="alert" className="rounded-lg border border-destructive p-4">{t(params.error === "limit" ? "وصلت للحد المؤقت لإنشاء النسخ. حاول لاحقًا." : params.error === "denied" ? "ليس لديك صلاحية لهذا الإجراء" : "تعذّر إنشاء النسخة. حاول مرة أخرى.")}</p>}
    {view === "data" ? <Card><CardHeader><CardTitle>{t("تنزيل الجداول")}</CardTitle><CardDescription>{t("نزّل جداول Excel أو اطبعها حسب صلاحياتك")}</CardDescription></CardHeader><CardContent className="divide-y">
      {exports.length ? exports.map(key => <div key={key} className="flex flex-wrap items-center justify-between gap-3 py-4"><span className="font-medium">{t(EXPORT_DATASETS[key].title)}</span><DatasetExport dataset={key} /></div>) : <p className="py-6 text-muted-foreground">{t("لا توجد جداول متاحة بصلاحياتك الحالية")}</p>}
    </CardContent></Card> : view === "files" ? await renderFiles() : view === "images" ? await renderImages() : await renderBackups()}
  </>;

  async function renderBackups() {
    if (!manage) return <Card><CardContent className="py-8">{t("إدارة النسخ الاحتياطية تتطلب صلاحية إعدادات المؤسسة")}</CardContent></Card>;
    const [health]=manage?await withOrgScope(org!.id,false,()=>db.select().from(organizationBackupHealth).where(eq(organizationBackupHealth.organizationId,org!.id)).limit(1)):[];
    const backups = await withOrgScope(org!.id, false, () => listBackups(org!.id, 50));
    return <>
      <div className="grid gap-3 sm:grid-cols-3">
        {[{ icon: "Archive", label: "النسخ الاحتياطية المخزّنة", value: backups.length.toLocaleString("en-GB") }, { icon: "CalendarCheck", label: "آخر نسخة احتياطية (القاهرة)", value: backups[0] ? date(backups[0].createdAt) : "—" }, { icon: "HardDrive", label: "حجم النسخ المحفوظة", value: bytes(backups.reduce((sum, b) => sum + b.sizeBytes, 0)) }].map(stat => <div key={stat.label} className="flex items-center gap-3 rounded-2xl border bg-card p-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon name={stat.icon} className="size-5" /></span><div><p className="text-xs text-muted-foreground">{t(stat.label)}</p><p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">{stat.value}</p></div></div>)}
      </div>
      {health&&<div role="status" className="rounded-xl border p-4 text-sm"><p className="font-semibold">{t("حالة النسخ اليومي")}: {t(health.status==="FAILED"?"فشلت آخر محاولة؛ تتم إعادة المحاولة تلقائيًا إن تبقت محاولات":health.status==="RUNNING"?"جارٍ إنشاء النسخة":"آخر مهمة اكتملت بنجاح")}</p><p className="mt-2 text-muted-foreground">{t("آخر نجاح (القاهرة)")}: {formatBackupDate(health.lastSuccessAt,locale)}</p>{health.lastFailureAt&&<p className="mt-1 text-muted-foreground">{t("آخر فشل (القاهرة)")}: {formatBackupDate(health.lastFailureAt,locale)}</p>}</div>}
      <Card className="border-primary/20 bg-gradient-to-l from-primary/5 to-card"><CardHeader><CardTitle>{t("نسخة من جداول المؤسسة")}</CardTitle><CardDescription>{t("نسخة مضغوطة من جداول البيانات؛ المرفقات متاحة في تبويب الملفات.")}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3 sm:flex-row [&_button]:w-full sm:[&_button]:w-auto">
        <form action={createStorageBackupAction}><StorageBackupButton /></form>
        <a href="/api/erp/backup" className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"><Icon name="Download" className="size-4" />{t("تحميل نسخة من بياناتي")}</a>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>{t("النسخ الاحتياطية المخزّنة")}</CardTitle></CardHeader><CardContent className="divide-y">
        {backups.length ? backups.map(b => <div key={b.id} className="flex items-center gap-3 py-4"><span className="hidden size-10 shrink-0 place-items-center rounded-xl bg-muted sm:grid"><Icon name="FileArchive" className="size-5 text-primary" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{date(b.createdAt)}</p><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span dir="ltr">{bytes(b.sizeBytes)}</span><span>· {b.totalRows.toLocaleString("en-GB")} {t("صف")}</span><span className="rounded-md bg-muted px-2 py-0.5">{t(b.kind === "MANUAL" ? "يدوي" : "تلقائي")}</span></div></div><a className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-primary hover:bg-primary/5" href={`/api/erp/backups/${b.id}`}><Icon name="Download" className="size-4" /><span className="hidden sm:inline">{t("تنزيل")}</span><span className="sr-only sm:hidden">{t("تنزيل")}</span></a></div>) : <p className="py-6 text-muted-foreground">{t("لا توجد نسخ محفوظة بعد")}</p>}
      </CardContent></Card>
    </>;
  }

  async function renderFiles() {
    const rules = ATTACHMENT_POLICIES.map(p => ({ ...p, condition: or(...p.prefixes.map(prefix => sql`upper(${documentAttachments.entityType}) like ${prefix + "%"}`))! }));
    const allowed = rules.filter(p => can(p.view)).map(p => p.condition);
    if (can("accounting.view")) allowed.push(not(or(...rules.map(p => p.condition))!));
    const q = (params.q ?? "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
    const where = and(eq(documentAttachments.organizationId, org!.id), allowed.length ? or(...allowed) : sql`false`, q ? ilike(documentAttachments.fileName, `%${q}%`) : undefined);
    const { files, total } = await withOrgScope(org!.id, false, async () => {
      const files = await db.select({ id: documentAttachments.id, name: documentAttachments.fileName, size: documentAttachments.fileSize, createdAt: documentAttachments.createdAt }).from(documentAttachments).where(where).orderBy(desc(documentAttachments.createdAt), desc(documentAttachments.id)).limit(50).offset((page - 1) * 50);
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documentAttachments).where(where);
      return { files, total: count.n };
    });
    const pageHref = (p: number) => `/storage?view=files&q=${encodeURIComponent(q)}&page=${p}`;
    return <Card><CardHeader><CardTitle>{t("ملفات المؤسسة")}</CardTitle><CardDescription>{t("المرفقات المتاحة حسب صلاحياتك")}</CardDescription></CardHeader><CardContent>
      <form className="mb-4 flex gap-2" method="get" action="/storage"><input type="hidden" name="view" value="files" /><input name="q" aria-label={t("بحث بالاسم")} defaultValue={q} placeholder={t("بحث بالاسم")} className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2" /><button className="rounded-lg border px-4">{t("بحث")}</button></form>
      <div className="divide-y">{files.length ? files.map(f => <div key={f.id} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="break-words font-medium">{f.name}</p><p className="text-sm text-muted-foreground">{bytes(f.size)} · {date(f.createdAt)}</p></div><a className="shrink-0 text-primary hover:underline" href={`/api/erp/attachments/${f.id}`}>{t("تنزيل")}</a></div>) : <p className="py-6 text-muted-foreground">{t("لا توجد ملفات مطابقة")}</p>}</div>
      <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm"><span>{total.toLocaleString()} {t("ملف")}</span><div className="flex gap-4">{page > 1 && <Link href={pageHref(page - 1)}>{t("السابق")}</Link>}{page * 50 < total && <Link href={pageHref(page + 1)}>{t("التالي")}</Link>}</div></div>
    </CardContent></Card>;
  }

  async function renderImages() {
    if (!can("inventory.view")) return <Card><CardContent className="py-8">{t("ليس لديك صلاحية لهذا الإجراء")}</CardContent></Card>;
    const q = (params.q ?? "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
    const where = and(eq(items.organizationId, org!.id), isNotNull(items.image), ne(items.image, ""), itemMatches(org!.id, q));
    const { images, total } = await withOrgScope(org!.id, false, async () => {
      const images = await db.select({ id: items.id, code: items.code, name: items.nameAr, url: items.image }).from(items).where(where).orderBy(asc(items.code), asc(items.id)).limit(50).offset((page - 1) * 50);
      const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(items).where(where);
      return { images, total: count.n };
    });
    const safeUrl = (value: string | null) => {
      try { const url = new URL(value ?? "", process.env.APP_URL ?? "https://app.sellerctrl.com"); return ["http:", "https:"].includes(url.protocol) ? url : null; } catch { return null; }
    };
    const pageHref = (p: number) => `/storage?view=images&q=${encodeURIComponent(q)}&page=${p}`;
    return <Card><CardHeader><CardTitle>{t("صور الأصناف")}</CardTitle><CardDescription>{t("افتح الصورة الأصلية لحفظها على جهازك")}</CardDescription></CardHeader><CardContent>
      <form className="mb-4 flex gap-2" method="get" action="/storage"><input type="hidden" name="view" value="images" /><input name="q" aria-label={t("اسم / كود / SKU / ASIN / باركود")} defaultValue={q} placeholder={t("اسم / كود / SKU / ASIN / باركود")} className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2" /><button className="rounded-lg border px-4">{t("بحث")}</button></form>
      <div className="divide-y">{images.length ? images.map(image => { const url = safeUrl(image.url); return <div key={image.id} className="flex items-center justify-between gap-4 py-4"><div className="min-w-0"><p className="break-words font-medium">{image.name}</p><p className="text-sm text-muted-foreground">{image.code} · {url?.hostname}</p></div>{url && <a className="shrink-0 text-primary hover:underline" href={url.href} target="_blank" rel="noopener noreferrer">{t("فتح الصورة")}</a>}</div>; }) : <p className="py-6 text-muted-foreground">{t("لا توجد ملفات مطابقة")}</p>}</div>
      <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm"><span>{total.toLocaleString()} {t("صورة")}</span><div className="flex gap-4">{page > 1 && <Link href={pageHref(page - 1)}>{t("السابق")}</Link>}{page * 50 < total && <Link href={pageHref(page + 1)}>{t("التالي")}</Link>}</div></div>
    </CardContent></Card>;
  }
}

