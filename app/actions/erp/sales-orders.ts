"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesOrders, salesOrderLines, customers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { createSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { tryRecordAudit } from "@/lib/erp/audit";

export type SaveOrderState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().optional(),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
});
const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "SO", year);
}

/** Create a sales order as DRAFT (no effect until confirmed). */
export async function createSalesOrderAction(input: unknown): Promise<SaveOrderState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { customerId, date, dueDate, notes, lines } = parsed.data;

  const [cust] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
  if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

  const computed = lines.map((l) => ({ ...l, totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount) }));
  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal - discountAmount + taxAmount);

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [so] = await tx.insert(salesOrders).values({
        organizationId: auth.orgId, number, customerId, date: d, dueDate: dueDate ? new Date(dueDate) : null,
        status: "DRAFT", subtotal: String(subtotal), discountAmount: String(discountAmount),
        taxAmount: String(taxAmount), totalAmount: String(totalAmount), notes: notes || null,
      }).returning({ id: salesOrders.id });
      await tx.insert(salesOrderLines).values(computed.map((l) => ({
        salesOrderId: so.id, itemId: l.itemId, warehouseId: l.warehouseId || null, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      return so.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_ORDER", entityId: id, entityNumber: number, summary: `إنشاء أمر بيع ${number} (مسودة)`, metadata: { total: totalAmount } });
    revalidatePath("/erp/sales/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الأمر مستخدم — أعد المحاولة" : "تعذّر حفظ الأمر" };
  }
}

/** Confirm a DRAFT sales order (approval/reservation — no stock/GL). */
export async function confirmSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "DRAFT") return { error: "الأمر مؤكّد بالفعل" };
  await db.update(salesOrders).set({ status: "CONFIRMED" }).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId)));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `تأكيد أمر بيع ${so.number}` });
  revalidatePath("/erp/sales/orders");
  revalidatePath(`/erp/sales/orders/${id}`);
  return { ok: true };
}

/** Delete a DRAFT sales order (confirmed orders are cancelled, not deleted). */
export async function deleteSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const [so] = await db.select({ status: salesOrders.status }).from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "DRAFT") return { error: "لا يمكن حذف أمر مؤكّد — استخدم الإلغاء" };
  await db.delete(salesOrders).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId)));
  revalidatePath("/erp/sales/orders");
  return { ok: true };
}

/** Convert a CONFIRMED sales order into a DRAFT sales invoice; mark it INVOICED. */
export async function convertSalesOrderToInvoiceAction(id: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "CONFIRMED") return { error: "الفوترة المباشرة للأوامر المؤكّدة فقط — بعد بدء التسليم استخدم الفوترة من إذن الصرف" };

  const lines = await db.select({
    itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity, unitPrice: salesOrderLines.unitPrice,
    discountAmount: salesOrderLines.discountAmount, taxAmount: salesOrderLines.taxAmount,
  }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));

  const r = await createSalesInvoiceAction({
    customerId: so.customerId, date: new Date(so.date).toISOString().slice(0, 10), notes: `من أمر بيع ${so.number}`,
    lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount) })),
  });
  if (!r.ok) return { error: r.error ?? "تعذّر إنشاء الفاتورة" };

  await db.update(salesOrders).set({ status: "INVOICED" }).where(eq(salesOrders.id, so.id));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONVERT", entityType: "SALES_ORDER", entityId: so.id, entityNumber: so.number, summary: `تحويل أمر بيع ${so.number} إلى فاتورة (مسودة)` });
  revalidatePath("/erp/sales/orders");
  revalidatePath("/erp/sales/invoices");
  return { ok: true, invoiceId: r.id };
}

/**
 * Bulk confirm / cancel / delete selected sales orders. Each id is checked
 * against the op's precondition (confirm/delete need DRAFT; cancel needs a
 * non-invoiced, non-cancelled order) and skipped otherwise.
 */
export async function bulkSalesOrdersAction(op: "confirm" | "cancel" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "sales.create" : "sales.confirm");
  if ("error" in auth) return auth;
  if (!ids.length) return { error: "لم تحدّد أي أمر" };

  let count = 0;
  for (const id of ids) {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) continue;
    if (op === "confirm" && so.status === "DRAFT") {
      await db.update(salesOrders).set({ status: "CONFIRMED" }).where(eq(salesOrders.id, id));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `تأكيد أمر بيع ${so.number}` });
      count++;
    } else if (op === "cancel" && so.status !== "INVOICED" && so.status !== "CANCELLED") {
      await db.update(salesOrders).set({ status: "CANCELLED" }).where(eq(salesOrders.id, id));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `إلغاء أمر بيع ${so.number}` });
      count++;
    } else if (op === "delete" && so.status === "DRAFT") {
      await db.delete(salesOrders).where(eq(salesOrders.id, id));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `حذف مسودة أمر بيع ${so.number}` });
      count++;
    }
  }
  revalidatePath("/erp/sales/orders");
  return { ok: true, count };
}

/** Cancel a sales order (only before it is invoiced). */
export async function cancelSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status === "INVOICED") return { error: "لا يمكن إلغاء أمر محوّل لفاتورة" };
  await db.update(salesOrders).set({ status: "CANCELLED" }).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId)));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `إلغاء أمر بيع ${so.number}` });
  revalidatePath("/erp/sales/orders");
  return { ok: true };
}
