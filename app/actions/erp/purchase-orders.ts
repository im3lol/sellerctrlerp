"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { purchaseOrders, purchaseOrderLines, suppliers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { createPurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { tryRecordAudit } from "@/lib/erp/audit";

export type SaveOrderState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  shippingPerUnit: z.coerce.number().min(0).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
});
const schema = z.object({
  supplierId: z.string().min(1, "اختر المورد"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "PO", year);
}

/** Create a purchase order as DRAFT (no effect until confirmed). */
export async function createPurchaseOrderAction(input: unknown): Promise<SaveOrderState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supplierId, warehouseId, date, notes, lines } = parsed.data;

  const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
  if (!sup) return { error: "المورد غير موجود في هذه المؤسسة" };

  const computed = lines.map((l) => ({ ...l, totalAmount: round2(l.quantity * l.unitPrice + l.quantity * l.shippingPerUnit - l.discountAmount + l.taxAmount) }));
  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const shippingAmount = round2(computed.reduce((s, l) => s + l.quantity * l.shippingPerUnit, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal + shippingAmount - discountAmount + taxAmount);

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [po] = await tx.insert(purchaseOrders).values({
        organizationId: auth.orgId, number, supplierId, warehouseId, date: d, status: "DRAFT",
        subtotal: String(subtotal), shippingAmount: String(shippingAmount), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
        totalAmount: String(totalAmount), notes: notes || null,
      }).returning({ id: purchaseOrders.id });
      await tx.insert(purchaseOrderLines).values(computed.map((l) => ({
        purchaseOrderId: po.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        shippingPerUnit: String(l.shippingPerUnit), discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      return po.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: number, summary: `إنشاء أمر شراء ${number} (مسودة)`, metadata: { total: totalAmount } });
    revalidatePath("/erp/purchases/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الأمر مستخدم — أعد المحاولة" : "تعذّر حفظ الأمر" };
  }
}

/** Confirm a DRAFT purchase order (approval only — no stock/GL). */
export async function confirmPurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "DRAFT") return { error: "الأمر مؤكّد بالفعل" };
  await db.update(purchaseOrders).set({ status: "CONFIRMED" }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `تأكيد أمر شراء ${po.number}` });
  revalidatePath("/erp/purchases/orders");
  revalidatePath(`/erp/purchases/orders/${id}`);
  return { ok: true };
}

/** Delete a DRAFT purchase order (confirmed orders are cancelled, not deleted). */
export async function deletePurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const [po] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "DRAFT") return { error: "لا يمكن حذف أمر مؤكّد — استخدم الإلغاء" };
  await db.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
  revalidatePath("/erp/purchases/orders");
  return { ok: true };
}

/** Convert a CONFIRMED purchase order into a DRAFT purchase invoice; mark it INVOICED. */
export async function convertPurchaseOrderToInvoiceAction(id: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "CONFIRMED") return { error: "الفوترة المباشرة للأوامر المؤكّدة فقط — بعد بدء الاستلام استخدم الفوترة من إذن الاستلام" };

  const lines = await db.select({
    itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice,
    shippingPerUnit: purchaseOrderLines.shippingPerUnit, discountAmount: purchaseOrderLines.discountAmount, taxAmount: purchaseOrderLines.taxAmount,
  }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const r = await createPurchaseInvoiceAction({
    supplierId: po.supplierId, warehouseId: po.warehouseId, date: new Date(po.date).toISOString().slice(0, 10),
    notes: `من أمر شراء ${po.number}`,
    // Capitalise shipping into the unit cost for the direct (no-receipt) path.
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) + Number(l.shippingPerUnit), discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount) })),
  });
  if (!r.ok) return { error: r.error ?? "تعذّر إنشاء الفاتورة" };

  await db.update(purchaseOrders).set({ status: "INVOICED" }).where(eq(purchaseOrders.id, po.id));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONVERT", entityType: "PURCHASE_ORDER", entityId: po.id, entityNumber: po.number, summary: `تحويل أمر شراء ${po.number} إلى فاتورة (مسودة)` });
  revalidatePath("/erp/purchases/orders");
  revalidatePath("/erp/purchases/invoices");
  return { ok: true, invoiceId: r.id };
}

/** Cancel a purchase order (only before it is invoiced). */
export async function cancelPurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status === "INVOICED") return { error: "لا يمكن إلغاء أمر محوّل لفاتورة" };
  await db.update(purchaseOrders).set({ status: "CANCELLED" }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `إلغاء أمر شراء ${po.number}` });
  revalidatePath("/erp/purchases/orders");
  return { ok: true };
}
