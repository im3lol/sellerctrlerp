"use server";
import { noticeTarget } from "@/lib/ui-notice";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { authorizeErp } from "@/lib/erp/action-auth";
import { getCurrentUser } from "@/lib/session";

import { db } from "@/lib/db";
import { platformIntegrations, storageCloudConnections } from "@/db/schema";
import { withOrgScope, withPlatformScope } from "@/lib/db-scope";
import { encryptSecret } from "@/lib/crypto";
import { CLOUD_PROVIDER, DRIVE_CONFIG } from "@/lib/erp/storage-cloud";
import { requestCloudBackup } from "@/lib/erp/cloud-backup-jobs";
import { getLocale } from "@/lib/i18n/server";

import { rateLimit } from "@/lib/rate-limit";
import { tryRecordAudit } from "@/lib/erp/audit";

export async function saveGoogleDriveConfigAction(form: FormData) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") redirect(await noticeTarget("/storage/cloud?error=denied"));
  const returnPath = form.get("source") === "admin-integrations" ? "/admin/integrations" : "/storage/admin";
  const clientId = String(form.get("clientId") || "").trim();
  const secret = String(form.get("clientSecret") || "").trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId) || secret.length > 2048) redirect(await noticeTarget(`${returnPath}?cloudError=1#google-drive`));
  await withPlatformScope(async () => {
    const [existing] = await db.select({ secret: platformIntegrations.clientSecret, clientId: platformIntegrations.clientId }).from(platformIntegrations).where(eq(platformIntegrations.code, DRIVE_CONFIG)).limit(1);
    if (existing?.clientId && existing.clientId !== clientId && !secret) redirect(await noticeTarget(`${returnPath}?cloudError=1#google-drive`));
    if (!secret && !existing?.secret && !process.env.GOOGLE_DRIVE_CLIENT_SECRET) redirect(await noticeTarget(`${returnPath}?cloudError=1#google-drive`));
    const clientSecret = secret ? encryptSecret(secret) : existing?.secret;
    await db.insert(platformIntegrations).values({ code: DRIVE_CONFIG, clientId, clientSecret, enabled: true }).onConflictDoUpdate({ target: platformIntegrations.code, set: { clientId, ...(clientSecret ? { clientSecret } : {}), enabled: true, updatedAt: new Date() } });
  });
  revalidatePath("/storage/cloud");
  revalidatePath("/admin/integrations");
  revalidatePath("/storage/admin");
  redirect(await noticeTarget(`${returnPath}?cloudSaved=1#google-drive`));
}

export async function disconnectGoogleDriveAction() {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) redirect(await noticeTarget("/storage/cloud?error=denied"));
  await withOrgScope(auth.orgId, false, async () => {
    await db.delete(storageCloudConnections).where(and(eq(storageCloudConnections.organizationId, auth.orgId), eq(storageCloudConnections.provider, CLOUD_PROVIDER)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "CLOUD_STORAGE", summary: "فصل Google Drive عن المؤسسة" });
  });
  revalidatePath("/storage/cloud");
  redirect(await noticeTarget("/storage/cloud?disconnected=1"));
}

export async function sendGoogleDriveBackupAction(form:FormData = new FormData()) {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) redirect(await noticeTarget("/storage/cloud?error=denied"));
  if (!(await rateLimit(`cloud-backup:${auth.orgId}`, 3, 60 * 60_000))) redirect(await noticeTarget("/storage/cloud?error=limit"));
  const resumeId=String(form.get("resumeId")||"");
  if(resumeId&&!/^[A-Za-z0-9_-]{1,100}$/.test(resumeId))redirect(await noticeTarget("/storage/cloud?error=denied"));
  try { await requestCloudBackup(auth.orgId,auth.userId,await getLocale(),resumeId||undefined); }
  catch { redirect(await noticeTarget("/storage/cloud?error=queue")); }
  revalidatePath("/storage/cloud");
  redirect(await noticeTarget("/storage/cloud?queued=1"));
}

export async function saveGoogleBackupScheduleAction(form:FormData) {
 const auth=await authorizeErp("settings.edit");
 if("error" in auth)redirect(await noticeTarget("/storage/cloud?error=denied"));
 const retain=Number(form.get("retainCopies"));if(![0,7,14,30].includes(retain))redirect(await noticeTarget("/storage/cloud?error=denied"));
 await withOrgScope(auth.orgId,false,()=>db.update(storageCloudConnections).set({dailyBackup:form.get("dailyBackup")==="on",retainCopies:retain}).where(and(eq(storageCloudConnections.organizationId,auth.orgId),eq(storageCloudConnections.provider,CLOUD_PROVIDER))));
 revalidatePath("/storage/cloud");
 redirect(await noticeTarget("/storage/cloud?scheduleSaved=1"));
}
