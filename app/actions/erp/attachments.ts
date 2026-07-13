"use server";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentAttachments } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import type { ErpPermission } from "@/lib/erp/permissions";
import { getActiveOrg } from "@/lib/erp/org";
import { storageLimitError } from "@/lib/erp/plans";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Attachments hang off documents across modules; gate them on the owning
// module's capability (not just org membership) so a viewer can't upload/delete/
// download. Reads need `.view`, writes need `.edit`/`.create`.
function permsFor(entityType: string): { view: ErpPermission; write: ErpPermission } {
  const t = entityType.toUpperCase();
  if (t.startsWith("SALES")) return { view: "sales.view", write: "sales.edit" };
  if (t.startsWith("PURCHASE")) return { view: "purchases.view", write: "purchases.edit" };
  if (t.startsWith("STOCK") || t.startsWith("ITEM") || t.startsWith("GOODS") || t.startsWith("ADJUST") || t.startsWith("TRANSFER"))
    return { view: "inventory.view", write: "inventory.edit" };
  // accounting + any unmapped type: safe default that still requires a write cap.
  return { view: "accounting.view", write: "accounting.create" };
}

export type AttachmentMeta = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: Date;
};

export async function getAttachmentsAction(entityType: string, entityId: string): Promise<AttachmentMeta[] | { error: string }> {
  const auth = await authorizeErp(permsFor(entityType).view);
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
  const auth = await authorizeErp(permsFor(entityType).write);
  if ("error" in auth) return auth;

  // Rough byte size: base64 is ~4/3 ratio
  const fileSize = Math.round((base64Content.length * 3) / 4);
  if (fileSize > MAX_FILE_SIZE) return { error: "حجم الملف أكبر من 10 ميجابايت" };

  const storageError = await storageLimitError(auth.orgId, fileSize);
  if (storageError) return { error: storageError };

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

// Resolve the active org for the caller (membership only) to locate a row by id
// before we know its entityType; capability is enforced afterwards.
async function activeOrgId(): Promise<{ error: string } | { orgId: string }> {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return { error: "غير مصرح" };
  return { orgId: org.id };
}

export async function deleteAttachmentAction(attachmentId: string): Promise<{ ok: true } | { error: string }> {
  const org = await activeOrgId();
  if ("error" in org) return org;

  const [row] = await db
    .select({ id: documentAttachments.id, entityType: documentAttachments.entityType })
    .from(documentAttachments)
    .where(and(eq(documentAttachments.id, attachmentId), eq(documentAttachments.organizationId, org.orgId)))
    .limit(1);
  if (!row) return { error: "المرفق غير موجود" };

  const auth = await authorizeErp(permsFor(row.entityType).write);
  if ("error" in auth) return auth;

  await db.delete(documentAttachments).where(and(eq(documentAttachments.id, attachmentId), eq(documentAttachments.organizationId, auth.orgId)));
  return { ok: true };
}

export async function getAttachmentContentAction(attachmentId: string): Promise<{ content: string; mimeType: string; fileName: string } | { error: string }> {
  const org = await activeOrgId();
  if ("error" in org) return org;

  const [row] = await db
    .select({
      content: documentAttachments.content,
      mimeType: documentAttachments.mimeType,
      fileName: documentAttachments.fileName,
      entityType: documentAttachments.entityType,
    })
    .from(documentAttachments)
    .where(and(eq(documentAttachments.id, attachmentId), eq(documentAttachments.organizationId, org.orgId)))
    .limit(1);
  if (!row) return { error: "المرفق غير موجود" };

  const auth = await authorizeErp(permsFor(row.entityType).view);
  if ("error" in auth) return auth;

  return { content: row.content, mimeType: row.mimeType, fileName: row.fileName };
}
