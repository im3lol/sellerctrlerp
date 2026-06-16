"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { files } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { putObject, deleteObject, buildStorageKey } from "@/lib/storage";
import { recordActivity } from "@/lib/activity";

export async function uploadFileAction(
  workspaceId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!(await canAccessWorkspace(user, workspaceId))) return { ok: false, error: "غير مصرّح" };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "لم يتم اختيار ملف" };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "الحجم يتجاوز 25MB" };

  const key = buildStorageKey(workspaceId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await putObject(key, buffer, file.type || "application/octet-stream");
  } catch {
    return { ok: false, error: "تعذّر رفع الملف إلى التخزين" };
  }

  await db.insert(files).values({
    workspaceId,
    name: file.name,
    mime: file.type || "application/octet-stream",
    sizeBytes: file.size,
    storageKey: key,
    uploadedBy: user.id,
  });

  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "file",
    action: "file.uploaded",
    summaryAr: `${user.name} رفع الملف «${file.name}»`,
  });

  revalidatePath(`/workspaces/${workspaceId}`);
  return { ok: true };
}

export async function deleteFileAction(fileId: string) {
  const user = await requireUser();
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f) return;
  if (!(await canAccessWorkspace(user, f.workspaceId))) throw new Error("forbidden");

  try {
    await deleteObject(f.storageKey);
  } catch {
    /* ignore storage errors on delete */
  }
  await db.delete(files).where(eq(files.id, fileId));
  revalidatePath(`/workspaces/${f.workspaceId}`);
}
