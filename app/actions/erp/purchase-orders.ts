"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { purchaseOrders, purchaseOrderLines, suppliers, purchaseReceipts, organizations, purchaseInvoices, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { createPurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { getBaseCurrencyCode, getExchangeRate } from "@/lib/erp/currency";
import { tryRecordAudit } from "@/lib/erp/audit";

export type SaveOrderState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  shippingPerUnit: z.coerce.number().min(0).default(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
  exempt: z.coerce.boolean().default(false),
});
const schema = z.object({
  supplierId: z.string().min(1, "اختر المورد"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  // Document currency: line amounts arrive in THIS currency and are converted to base
  // (× exchange rate) before storing, so the GL/inventory stay base-only. Omitted = base.
  currencyCode: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});
async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "PO", year);
}

/** Create a purchase order as DRAFT (no effect until confirmed). */
export async function createPurchaseOrderAction(input: unknown): Promise<SaveOrderState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { supplierId, warehouseId, date, notes, lines } = parsed.data;

    const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
      .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
    if (!sup) return { error: "المورد غير موجود في هذه المؤسسة" };
    // The warehouse id flows into the GRN and its stock movements — verify it
    // belongs to the org (same IDOR class as the supplier check above).
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
    if (!wh) return { error: "المستودع غير موجود في هذه المؤسسة" };

    const d = new Date(date);

    // Foreign currency: line amounts arrive in the document currency; convert to base
    // (EGP) once here so everything downstream (inventory valuation, GL) stays base.
    const baseCode = await getBaseCurrencyCode(auth.orgId);
    const code = (parsed.data.currencyCode ?? baseCode).toUpperCase();
    const isForeign = code !== baseCode.toUpperCase();
    const rate = isForeign ? await getExchangeRate(auth.orgId, code, baseCode, d) : 1;
    if (isForeign && rate <= 0) return { error: `لا يوجد سعر صرف مسجّل لـ${code} — أضِفه من الإعدادات ← العملات ثم أعد المحاولة` };
    const toBase = (n: number) => round2(n * rate);
    // Foreign document total (as entered) — kept for display only.
    const foreignTotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice + l.quantity * l.shippingPerUnit - l.discountAmount + l.taxAmount, 0));

    const computed = lines.map((l) => {
      const unitPrice = toBase(l.unitPrice);
      const shippingPerUnit = toBase(l.shippingPerUnit);
      const discountAmount = toBase(l.discountAmount);
      const taxAmount = toBase(l.taxAmount);
      return { itemId: l.itemId, quantity: l.quantity, unitPrice, shippingPerUnit, discountAmount, taxAmount, exempt: l.exempt,
        totalAmount: round2(l.quantity * unitPrice + l.quantity * shippingPerUnit - discountAmount + taxAmount) };
    });
    const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const shippingAmount = round2(computed.reduce((s, l) => s + l.quantity * l.shippingPerUnit, 0));
    const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
    const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = round2(subtotal + shippingAmount - discountAmount + taxAmount);

    const number = await nextNumber(auth.orgId, d.getFullYear());

    try {
      const id = await db.transaction(async (tx) => {
        const [po] = await tx.insert(purchaseOrders).values({
          organizationId: auth.orgId, number, supplierId, warehouseId, date: d, status: "DRAFT",
          subtotal: String(subtotal), shippingAmount: String(shippingAmount), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
          totalAmount: String(totalAmount), notes: notes || null,
          currencyCode: code, exchangeRate: String(rate), foreignAmount: isForeign ? String(foreignTotal) : null,
        }).returning({ id: purchaseOrders.id });
        await tx.insert(purchaseOrderLines).values(computed.map((l) => ({
          purchaseOrderId: po.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          shippingPerUnit: String(l.shippingPerUnit), discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), isTaxExempt: l.exempt, totalAmount: String(l.totalAmount),
        })));
        return po.id;
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: number, summary: `إنشاء أمر شراء ${number} (مسودة)`, metadata: { total: totalAmount } });
      revalidatePath("/purchases/orders");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error && e.message.includes("unique") ? "رقم الأمر مستخدم — أعد المحاولة" : "تعذّر حفظ الأمر" };
    }
  });
}

/** Confirm a DRAFT purchase order (approval only — no stock/GL). Above the org's
 *  approval threshold the order must be approved first. */
export async function confirmPurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number, total: purchaseOrders.totalAmount, approvedAt: purchaseOrders.approvedAt }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status !== "DRAFT") return { error: "الأمر مؤكّد بالفعل" };

    const [org] = await db.select({ threshold: organizations.poApprovalThreshold }).from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
    const threshold = Number(org?.threshold ?? 0);
    if (threshold > 0 && Number(po.total) > threshold && !po.approvedAt) {
      return { error: `أمر شراء بقيمة تتجاوز حد الاعتماد (${threshold.toLocaleString("ar-EG")}) — يجب اعتماده أولاً` };
    }

    await db.update(purchaseOrders).set({ status: "CONFIRMED" }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `تأكيد أمر شراء ${po.number}` });
    revalidatePath("/purchases/orders");
    revalidatePath(`/purchases/orders/${id}`);
    return { ok: true };
  });
}

/** Approve a DRAFT purchase order so it can be confirmed (spending control). */
export async function approvePurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number, approvedAt: purchaseOrders.approvedAt }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status !== "DRAFT") return { error: "لا يمكن اعتماد أمر مؤكّد" };
    if (po.approvedAt) return { error: "الأمر معتمد بالفعل" };
    await db.update(purchaseOrders).set({ approvedBy: auth.userId, approvedAt: new Date() }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `اعتماد أمر شراء ${po.number}` });
    revalidatePath("/purchases/orders");
    revalidatePath(`/purchases/orders/${id}`);
    return { ok: true };
  });
}

/** Delete a DRAFT order, or a CANCELLED order that isn't linked to any goods receipt. */
export async function deletePurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status !== "DRAFT" && po.status !== "CANCELLED") return { error: "يمكن حذف مسودة أو أمر ملغى فقط — أكّد الإلغاء أولاً" };
    if (po.status === "CANCELLED") {
      const [grn] = await db.select({ id: purchaseReceipts.id }).from(purchaseReceipts)
        .where(and(eq(purchaseReceipts.purchaseOrderId, id), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
      if (grn) return { error: "لا يمكن حذف أمر مرتبط بإذون استلام" };
    }
    await db.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `حذف أمر شراء ${po.number}` });
    revalidatePath("/purchases/orders");
    return { ok: true };
  });
}

/** Convert a CONFIRMED purchase order into a DRAFT purchase invoice; mark it INVOICED. */
export async function convertPurchaseOrderToInvoiceAction(id: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
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
      // Carry the PO's document currency so the invoice shows it (amounts are already base).
      currencyCode: po.currencyCode, exchangeRate: Number(po.exchangeRate),
      // Capitalise shipping into the unit cost for the direct (no-receipt) path.
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) + Number(l.shippingPerUnit), discountAmount: Number(l.discountAmount), taxAmount: Number(l.taxAmount) })),
    });
    if (!r.ok) return { error: r.error ?? "تعذّر إنشاء الفاتورة" };

    // Link invoice→order so deleting the draft invoice can reopen the order (Audit#7).
    if (r.id) await db.update(purchaseInvoices).set({ purchaseOrderId: po.id }).where(and(eq(purchaseInvoices.id, r.id), eq(purchaseInvoices.organizationId, auth.orgId)));
    await db.update(purchaseOrders).set({ status: "INVOICED" }).where(eq(purchaseOrders.id, po.id));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONVERT", entityType: "PURCHASE_ORDER", entityId: po.id, entityNumber: po.number, summary: `تحويل أمر شراء ${po.number} إلى فاتورة (مسودة)` });
    revalidatePath("/purchases/orders");
    revalidatePath("/purchases/invoices");
    return { ok: true, invoiceId: r.id };
  });
}

/** Cancel a purchase order (only before it is invoiced). */
export async function cancelPurchaseOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status === "INVOICED") return { error: "لا يمكن إلغاء أمر محوّل لفاتورة" };
    // See cancelSalesOrderAction: blocking INVOICED alone lets a part-received order
    // (which never reaches INVOICED) be cancelled while carrying posted stock.
    const moved = await db.select({ r: purchaseOrderLines.receivedQty, inv: purchaseOrderLines.invoicedQty })
      .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
    if (moved.some((l) => Number(l.r) > 0 || Number(l.inv) > 0)) {
      return { error: "الأمر مستلم/مفوتر جزئيًا — اعكس الاستلام أو أنشئ مرتجعًا بدل الإلغاء" };
    }
    await db.update(purchaseOrders).set({ status: "CANCELLED" }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `إلغاء أمر شراء ${po.number}` });
    revalidatePath("/purchases/orders");
    return { ok: true };
  });
}

/**
 * Bulk confirm / cancel / delete selected purchase orders. Each id is checked
 * against the op's precondition (confirm/delete need DRAFT; cancel needs a
 * non-invoiced, non-cancelled order) and skipped otherwise. Returns how many
 * actually changed.
 */
export async function bulkPurchaseOrdersAction(op: "confirm" | "cancel" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "purchases.create" : "purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    if (!ids.length) return { error: "لم تحدّد أي أمر" };

    let count = 0;
    for (const id of ids) {
      const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
      if (!po) continue;
      if (op === "confirm" && po.status === "DRAFT") {
        await db.update(purchaseOrders).set({ status: "CONFIRMED" }).where(eq(purchaseOrders.id, id));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `تأكيد أمر شراء ${po.number}` });
        count++;
      } else if (op === "cancel" && po.status !== "INVOICED" && po.status !== "CANCELLED") {
        // Same guard as cancelPurchaseOrderAction: a part-received/part-invoiced order
        // carries posted stock/GRNI a cancel does not reverse — skip it, don't cancel.
        const moved = await db.select({ r: purchaseOrderLines.receivedQty, inv: purchaseOrderLines.invoicedQty })
          .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
        if (moved.some((l) => Number(l.r) > 0 || Number(l.inv) > 0)) continue;
        await db.update(purchaseOrders).set({ status: "CANCELLED" }).where(eq(purchaseOrders.id, id));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `إلغاء أمر شراء ${po.number}` });
        count++;
      } else if (op === "delete" && po.status === "DRAFT") {
        await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `حذف مسودة أمر شراء ${po.number}` });
        count++;
      }
    }
    revalidatePath("/purchases/orders");
    return { ok: true, count };
  });
}

/** Reopen a CONFIRMED purchase order back to DRAFT (only when nothing received/invoiced). */
export async function revertPurchaseOrderToDraftAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status !== "CONFIRMED") return { error: "يمكن إعادة فتح أمر مؤكّد فقط" };
    const lines = await db.select({ r: purchaseOrderLines.receivedQty, inv: purchaseOrderLines.invoicedQty })
      .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
    if (lines.some((l) => Number(l.r) > 0 || Number(l.inv) > 0)) return { error: "اعكس الاستلام/الفاتورة أولاً قبل إعادة فتح الأمر" };
    await db.update(purchaseOrders).set({ status: "DRAFT" }).where(eq(purchaseOrders.id, id));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `إعادة فتح أمر شراء ${po.number} كمسودة` });
    revalidatePath("/purchases/orders");
    revalidatePath(`/purchases/orders/${id}`);
    return { ok: true };
  });
}
