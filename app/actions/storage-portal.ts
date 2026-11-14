"use server";
import { noticeTarget } from "@/lib/ui-notice";


import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorizeErp } from "@/lib/erp/action-auth";
import { getActiveOrg } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { backupOrgToStorage } from "@/lib/erp/backup";
import { tryRecordAudit } from "@/lib/erp/audit";
import { rateLimit } from "@/lib/rate-limit";
import { setActiveOrgAction } from "@/app/actions/org";

export async function createStorageBackupAction() {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) redirect(await noticeTarget("/storage?error=denied"));
  if (!(await rateLimit(`manual-backup:${auth.orgId}`, 3, 60 * 60_000))) redirect(await noticeTarget("/storage?error=limit"));
  const { org } = await getActiveOrg();
  try {
    await withOrgScope(auth.orgId, false, async () => {
      const backup = await backupOrgToStorage(auth.orgId, org?.nameAr ?? "org", "MANUAL", auth.userId);
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "DATA_BACKUP", summary: "إنشاء نسخة محفوظة من بوابة التخزين", metadata: { rows: backup.totalRows, tables: backup.tableCount } });
    });
  } catch {
    redirect(await noticeTarget("/storage?error=backup"));
  }
  revalidatePath("/storage");
  redirect(await noticeTarget("/storage?created=1"));
}

export async function openStorageOrgAction(orgId: string) {
  if (!(await setActiveOrgAction(orgId)).ok) redirect(await noticeTarget("/storage?error=denied"));
  redirect("/storage");
}
