"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentAttachments } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getErpRole } from "@/lib/erp/auth-guard";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

async function getOrgAndUser(): Promise<{ error: string } | { orgId: string; userId: string }> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { error: "غير مصرح" };
  const role = await getErpRole(org.id, user);
  if (!role) return { error: "غير مصرح بالوصول" };
  return { orgId: org.id, userId: user.id };
}

export type AttachmentMeta = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
};

export async function getAttachmentsAction(entityType: string, entityId: string): Promise<AttachmentMeta[] | { error: string }> {
  const auth = await getOrgAndUser();
  if ("error" in auth) return auth;

  return db
    .select({
      id: documentAttachments.id,
      fileName: documentAttachments.fileName,
      fileSize: documentAttachments.fileSize,
      mimeType: documentAttachments.mimeType,
      createdAt: documentAttachments.createdAt,
    })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.organizationId, auth.orgId),
        eq(documentAttachments.entityType, entityType),
        eq(documentAttachments.entityId, entityId),
      ),
    )
    .orderBy(asc(documentAttachments.createdAt));
}

export async function addAttachmentAction(
  entityType: string,
  entityId: string,
  fileName: string,
  mimeType: string,
  base64Content: string,
): Promise<{ ok: true; id: string } | { error: string }> {
  const auth = await getOrgAndUser();
  if ("error" in auth) return auth;

  // Rough byte size: base64 is ~4/3 ratio
  const fileSize = Math.round((base64Content.length * 3) / 4);
  if (fileSize > MAX_FILE_SIZE) return { error: "حجم الملف أكبر من 10 ميجابايت" };

  const [row] = await db
    .insert(documentAttachments)
    .values({
      organizationId: auth.orgId,
      entityType,
      entityId,
      fileName,
      fileSize,
      mimeType,
      content: base64Content,
      uploadedBy: auth.userId,
    })
    .returning({ id: documentAttachments.id });

  return { ok: true, id: row.id };
}

export async function deleteAttachmentAction(attachmentId: string): Promise<{ ok: true } | { error: string }> {
  const auth = await getOrgAndUser();
  if ("error" in auth) return auth;

  const [row] = await db
    .select({ id: documentAttachments.id })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.id, attachmentId),
        eq(documentAttachments.organizationId, auth.orgId),
      ),
    )
    .limit(1);

  if (!row) return { error: "المرفق غير موجود" };

  await db.delete(documentAttachments).where(eq(documentAttachments.id, attachmentId));
  return { ok: true };
}

export async function getAttachmentContentAction(attachmentId: string): Promise<{ content: string; mimeType: string; fileName: string } | { error: string }> {
  const auth = await getOrgAndUser();
  if ("error" in auth) return auth;

  const [row] = await db
    .select({
      content: documentAttachments.content,
      mimeType: documentAttachments.mimeType,
      fileName: documentAttachments.fileName,
    })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.id, attachmentId),
        eq(documentAttachments.organizationId, auth.orgId),
      ),
    )
    .limit(1);

  if (!row) return { error: "المرفق غير موجود" };
  return row;
}
