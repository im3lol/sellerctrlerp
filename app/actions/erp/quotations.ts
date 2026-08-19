"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesQuotations, salesQuotationLines, customers, items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { bulkOp, type BulkOpResult } from "@/lib/erp/bulk-delete";

export type SaveState = ActionState & { id?: string };

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  // Discount on the whole quote, on top of the per-line ones.
  discountAmount: z.coerce.number().min(0).default(0),
  lines: z.array(z.object({
    itemId: z.string().min(1),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0),
    discountAmount: z.coerce.number().min(0).default(0),
    taxAmount: z.coerce.number().min(0).default(0),
    exempt: z.coerce.boolean().default(false),
  })).min(1, "أضف بنداً واحداً على الأقل"),
});

const STATUSES = ["SENT", "ACCEPTED", "REJECTED"];

/** Create a sales quotation as DRAFT (no GL/stock). */
export async function createQuotationAction(input: unknown): Promise<SaveState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const [cust] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود" };
    const valid = new Set((await db.select({ id: items.id }).from(items).where(eq(items.organizationId, auth.orgId))).map((r) => r.id));
    if (d.lines.some((l) => !valid.has(l.itemId))) return { error: "صنف غير موجود" };

    const dt = new Date(d.date);
    try {
      const id = await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, auth.orgId, "QT", dt.getFullYear());
        const [qt] = await tx.insert(salesQuotations).values({
          organizationId: auth.orgId, number, customerId: d.customerId, date: dt,
          validUntil: d.validUntil ? new Date(d.validUntil) : null, status: "DRAFT", notes: d.notes || null,
          discountAmount: String(d.discountAmount),
        }).returning({ id: salesQuotations.id });
        await tx.insert(salesQuotationLines).values(d.lines.map((l) => ({
          quotationId: qt.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), isTaxExempt: l.exempt,
        })));
        return qt.id;
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "QUOTATION", entityId: id, summary: "إنشاء عرض سعر (مسودة)" });
      revalidatePath("/sales/quotations");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}

/** Edit a DRAFT quotation in place: replace its lines + header, keep the number.
 *  Only DRAFT is editable. */
export async function updateQuotationAction(id: string, input: unknown): Promise<SaveState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = parsed.data;

    const [existing] = await db.select({ status: salesQuotations.status }).from(salesQuotations)
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId))).limit(1);
    if (!existing) return { error: "العرض غير موجود" };
    if (existing.status !== "DRAFT") return { error: "لا يمكن تعديل عرض غير مسودة" };

    const [cust] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود" };
    const valid = new Set((await db.select({ id: items.id }).from(items).where(eq(items.organizationId, auth.orgId))).map((r) => r.id));
    if (d.lines.some((l) => !valid.has(l.itemId))) return { error: "صنف غير موجود" };

    try {
      await db.transaction(async (tx) => {
        // Re-check the status under a row lock: accepting the quotation can land between
        // the read above and here, and an accepted offer's lines must not change under it.
        const [live] = await tx.select({ status: salesQuotations.status }).from(salesQuotations)
          .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId))).limit(1).for("update");
        if (live?.status !== "DRAFT") throw new Error("لا يمكن تعديل عرض غير مسودة");
        await tx.update(salesQuotations).set({
          customerId: d.customerId, date: new Date(d.date), validUntil: d.validUntil ? new Date(d.validUntil) : null, notes: d.notes || null,
          discountAmount: String(d.discountAmount), updatedAt: new Date(),
        }).where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId)));
        await tx.delete(salesQuotationLines).where(eq(salesQuotationLines.quotationId, id));
        await tx.insert(salesQuotationLines).values(d.lines.map((l) => ({
          quotationId: id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), isTaxExempt: l.exempt,
        })));
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "QUOTATION", entityId: id, summary: "تعديل عرض سعر (مسودة)" });
      revalidatePath("/sales/quotations");
      revalidatePath(`/sales/quotations/${id}`);
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ التعديل" };
    }
  });
}

/** Update a quotation's status (SENT / ACCEPTED / REJECTED). */
export async function setQuotationStatusAction(id: string, status: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    if (!STATUSES.includes(status)) return { error: "حالة غير صحيحة" };
    const [qt] = await db.select({ status: salesQuotations.status }).from(salesQuotations)
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId))).limit(1);
    if (!qt) return { error: "العرض غير موجود" };
    const moved = await db.update(salesQuotations).set({ status, updatedAt: new Date() })
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId), eq(salesQuotations.status, qt.status)))
      .returning({ id: salesQuotations.id });
    if (!moved.length) return { error: "تغيّرت حالة العرض — حدّث الصفحة" };
    const label = status === "ACCEPTED" ? "قبول" : status === "REJECTED" ? "رفض" : `تغيير حالة إلى ${status}`;
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: status === "ACCEPTED" ? "CONFIRM" : "UPDATE", entityType: "QUOTATION", entityId: id, summary: `${label} عرض سعر` });
    revalidatePath("/sales/quotations");
    revalidatePath(`/sales/quotations/${id}`);
    return { ok: true };
  });
}

/** Delete a quotation (not once accepted). */
export async function deleteQuotationAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [qt] = await db.select({ status: salesQuotations.status }).from(salesQuotations)
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId))).limit(1);
    if (!qt) return { error: "العرض غير موجود" };
    if (qt.status === "ACCEPTED") return { error: "لا يمكن حذف عرض مقبول" };
    const gone = await db.delete(salesQuotations)
      .where(and(eq(salesQuotations.id, id), eq(salesQuotations.organizationId, auth.orgId), eq(salesQuotations.status, qt.status)))
      .returning({ id: salesQuotations.id });
    if (!gone.length) return { error: "تغيّرت حالة العرض — حدّث الصفحة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "QUOTATION", entityId: id, summary: "حذف عرض سعر" });
    revalidatePath("/sales/quotations");
    return { ok: true };
  });
}

/** Bulk accept/reject (status) or delete quotations; accepted rows resist delete. */
export async function bulkQuotationsAction(op: "accept" | "reject" | "delete", ids: string[]): Promise<BulkOpResult> {
  if (op === "delete") return bulkOp(ids, deleteQuotationAction);
  const status = op === "accept" ? "ACCEPTED" : "REJECTED";
  return bulkOp(ids, (id) => setQuotationStatusAction(id, status));
}
