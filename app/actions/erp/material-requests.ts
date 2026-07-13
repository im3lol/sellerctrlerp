"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { materialRequests, materialRequestLines, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";

export type SaveState = ActionState & { id?: string };

const schema = z.object({
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(z.object({ itemId: z.string().min(1), quantity: z.coerce.number().positive() })).min(1, "أضف بنداً واحداً على الأقل"),
});

/** Create a purchase requisition (internal request for items) as DRAFT. */
export async function createMaterialRequestAction(input: unknown): Promise<SaveState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { date, notes, lines } = parsed.data;

  const ids = [...new Set(lines.map((l) => l.itemId))];
  const found = await db.select({ id: items.id }).from(items).where(and(eq(items.organizationId, auth.orgId)));
  const valid = new Set(found.map((f) => f.id));
  if (ids.some((id) => !valid.has(id))) return { error: "صنف غير موجود في هذه المؤسسة" };

  const d = new Date(date);
  try {
    const id = await db.transaction(async (tx) => {
      const number = await nextDocumentNumber(tx, auth.orgId, "MR", d.getFullYear());
      const [mr] = await tx.insert(materialRequests).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT", requestedBy: auth.userId, notes: notes || null,
      }).returning({ id: materialRequests.id });
      await tx.insert(materialRequestLines).values(lines.map((l) => ({
        materialRequestId: mr.id, itemId: l.itemId, quantity: String(l.quantity),
      })));
      return mr.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "MATERIAL_REQUEST", entityId: id, summary: "إنشاء طلب مواد (مسودة)" });
    revalidatePath("/erp/purchases/requisitions");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
  }
}

/** Approve a DRAFT requisition (makes it ready to convert to a PO). */
export async function approveMaterialRequestAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  const [mr] = await db.select({ status: materialRequests.status }).from(materialRequests)
    .where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, auth.orgId))).limit(1);
  if (!mr) return { error: "الطلب غير موجود" };
  if (mr.status !== "DRAFT") return { error: "الطلب معتمد بالفعل" };
  await db.update(materialRequests).set({ status: "APPROVED", approvedBy: auth.userId, updatedAt: new Date() })
    .where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, auth.orgId)));
  revalidatePath("/erp/purchases/requisitions");
  revalidatePath(`/erp/purchases/requisitions/${id}`);
  return { ok: true };
}

/** Delete a DRAFT requisition. */
export async function deleteMaterialRequestAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const [mr] = await db.select({ status: materialRequests.status }).from(materialRequests)
    .where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, auth.orgId))).limit(1);
  if (!mr) return { error: "الطلب غير موجود" };
  if (mr.status === "APPROVED") return { error: "لا يمكن حذف طلب معتمد" };
  await db.delete(materialRequests).where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, auth.orgId)));
  revalidatePath("/erp/purchases/requisitions");
  return { ok: true };
}

export async function bulkDeleteMaterialRequestsAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteMaterialRequestAction);
}
