"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesOrders, salesOrderLines, customers, items, deliveryNotes, salesInvoices } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { createSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { createDeliveryFromOrderAction } from "@/app/actions/erp/deliveries";
import { getAvailability } from "@/lib/erp/availability";
import { tryRecordAudit } from "@/lib/erp/audit";

export type SaveOrderState = ActionState & { id?: string; warning?: string };

const qf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

const lineSchema = z.object({
  itemId: z.string().min(1),
  warehouseId: z.string().optional(),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
  exempt: z.coerce.boolean().default(false),
});
const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  channel: z.enum(["MANUAL", "AMAZON", "NOON"]).default("MANUAL"),
  externalOrderId: z.string().optional(), // marketplace order number (Amazon/Noon)
  shippingAmount: z.coerce.number().min(0).default(0),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});
async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "SO", year);
}

/** Create a sales order as DRAFT (no effect until confirmed). */
export async function createSalesOrderAction(input: unknown): Promise<SaveOrderState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { customerId, date, dueDate, notes, channel, lines } = parsed.data;
    const shippingAmount = round2(parsed.data.shippingAmount);
    const externalOrderId = channel !== "MANUAL" ? (parsed.data.externalOrderId?.trim() || "") : "";
    if (channel !== "MANUAL" && !externalOrderId) return { error: "أدخل رقم الطلب" };

    const [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

    // Reject a marketplace order number already recorded for this channel.
    if (externalOrderId) {
      const [dup] = await db.select({ id: salesOrders.id }).from(salesOrders)
        .where(and(eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.channel, channel), eq(salesOrders.externalOrderId, externalOrderId))).limit(1);
      if (dup) return { error: "رقم الطلب مسجّل مسبقاً لهذه القناة" };
    }

    // Reservation check — informative (does not block; the order still reserves,
    // and delivery hard-blocks any negative stock). Warns which orders hold stock.
    let warning: string | undefined;
    const reqByItem = new Map<string, number>();
    for (const l of lines) reqByItem.set(l.itemId, (reqByItem.get(l.itemId) ?? 0) + l.quantity);
    const avail = await getAvailability(auth.orgId, [...reqByItem.keys()]);
    const over = [...reqByItem.entries()].filter(([id, req]) => (avail.get(id)?.available ?? 0) < req - 1e-9);
    if (over.length) {
      const nameRows = await db.select({ id: items.id, name: items.nameAr, code: items.code }).from(items).where(inArray(items.id, over.map(([id]) => id)));
      const nameById = new Map(nameRows.map((r) => [r.id, r.name || r.code]));
      warning = over.map(([id, req]) => {
        const a = avail.get(id)!;
        const holders = a.reservedBy.slice(0, 3).map((h) => `${h.number} (${qf(h.qty)})`).join("، ");
        return `«${nameById.get(id) ?? id}»: طلبت ${qf(req)} والمتاح ${qf(a.available)}${a.reserved > 0 ? ` — محجوز ${qf(a.reserved)} لأوامر: ${holders}` : ""}`;
      }).join("؛ ");
    }

    const computed = lines.map((l) => ({ ...l, totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount) }));
    const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
    const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = round2(subtotal - discountAmount + taxAmount + shippingAmount);

    const d = new Date(date);
    const number = await nextNumber(auth.orgId, d.getFullYear());

    try {
      const id = await db.transaction(async (tx) => {
        const [so] = await tx.insert(salesOrders).values({
          organizationId: auth.orgId, number, customerId, date: d, dueDate: dueDate ? new Date(dueDate) : null,
          status: "DRAFT", subtotal: String(subtotal), discountAmount: String(discountAmount),
          taxAmount: String(taxAmount), shippingAmount: String(shippingAmount), totalAmount: String(totalAmount),
          channel, externalOrderId: externalOrderId || null, notes: notes || null,
        }).returning({ id: salesOrders.id });
        await tx.insert(salesOrderLines).values(computed.map((l) => ({
          salesOrderId: so.id, itemId: l.itemId, warehouseId: l.warehouseId || null, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), isTaxExempt: l.exempt, totalAmount: String(l.totalAmount),
        })));
        return so.id;
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_ORDER", entityId: id, entityNumber: number, summary: `إنشاء أمر بيع ${number} (مسودة)`, metadata: { total: totalAmount } });
      revalidatePath("/sales/orders");
      return { ok: true, id, warning };
    } catch (e) {
      return { error: e instanceof Error && e.message.includes("unique") ? "رقم الأمر مستخدم — أعد المحاولة" : "تعذّر حفظ الأمر" };
    }
  });
}

/** Edit a DRAFT sales order in place: replace its lines + header, keep the number and
 *  the marketplace linkage (channel + externalOrderId). Only DRAFT is editable. */
export async function updateSalesOrderAction(id: string, input: unknown): Promise<SaveOrderState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { customerId, date, dueDate, notes, lines } = parsed.data;
    const shippingAmount = round2(parsed.data.shippingAmount);

    const [existing] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!existing) return { error: "الأمر غير موجود" };
    if (existing.status !== "DRAFT") return { error: "لا يمكن تعديل أمر مؤكّد — أعِد فتحه كمسودة أولاً" };

    const [cust] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

    const computed = lines.map((l) => ({ ...l, totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount) }));
    const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
    const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
    const totalAmount = round2(subtotal - discountAmount + taxAmount + shippingAmount);

    try {
      await db.transaction(async (tx) => {
        // Re-check the status under a row lock: «تأكيد» can land between the read above
        // and here, and rewriting a confirmed order's lines would leave the delivery /
        // invoice built from it describing quantities nobody ever approved.
        const [live] = await tx.select({ status: salesOrders.status }).from(salesOrders)
          .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1).for("update");
        if (live?.status !== "DRAFT") throw new Error("لا يمكن تعديل أمر مؤكّد — أعِد فتحه كمسودة أولاً");
        // channel + externalOrderId intentionally left untouched — editing must not alter
        // a marketplace order's identity.
        await tx.update(salesOrders).set({
          customerId, date: new Date(date), dueDate: dueDate ? new Date(dueDate) : null,
          subtotal: String(subtotal), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
          shippingAmount: String(shippingAmount), totalAmount: String(totalAmount), notes: notes || null, updatedAt: new Date(),
        }).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId)));
        await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
        await tx.insert(salesOrderLines).values(computed.map((l) => ({
          salesOrderId: id, itemId: l.itemId, warehouseId: l.warehouseId || null, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), isTaxExempt: l.exempt, totalAmount: String(l.totalAmount),
        })));
      });
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "SALES_ORDER", entityId: id, entityNumber: existing.number, summary: `تعديل أمر بيع ${existing.number} (مسودة)`, metadata: { total: totalAmount } });
      revalidatePath("/sales/orders");
      revalidatePath(`/sales/orders/${encodeURIComponent(existing.number)}`);
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ التعديل" };
    }
  });
}

/** Confirm a DRAFT sales order (approval/reservation — no stock/GL). */
export async function confirmSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) return { error: "الأمر غير موجود" };
    if (so.status !== "DRAFT") return { error: "الأمر مؤكّد بالفعل" };
    // Compare-and-swap on the status just read, so a concurrent edit/cancel can't slip in.
    const done = await db.update(salesOrders).set({ status: "CONFIRMED" })
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.status, "DRAFT")))
      .returning({ id: salesOrders.id });
    if (!done.length) return { error: "تغيّرت حالة الأمر — حدّث الصفحة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `تأكيد أمر بيع ${so.number}` });
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${encodeURIComponent(so.number)}`);
    return { ok: true };
  });
}

/** Delete a DRAFT order, or a CANCELLED order that isn't linked to any delivery. */
export async function deleteSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) return { error: "الأمر غير موجود" };
    if (so.status !== "DRAFT" && so.status !== "CANCELLED") return { error: "يمكن حذف مسودة أو أمر ملغى فقط — أكّد الإلغاء أولاً" };
    if (so.status === "CANCELLED") {
      const [dn] = await db.select({ id: deliveryNotes.id }).from(deliveryNotes)
        .where(and(eq(deliveryNotes.salesOrderId, id), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
      if (dn) return { error: "لا يمكن حذف أمر مرتبط بإذون صرف" };
    }
    const gone = await db.delete(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.status, so.status)))
      .returning({ id: salesOrders.id });
    if (!gone.length) return { error: "تغيّرت حالة الأمر — حدّث الصفحة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `حذف أمر بيع ${so.number}` });
    revalidatePath("/sales/orders");
    return { ok: true };
  });
}

/** Convert a CONFIRMED sales order into a DRAFT sales invoice; mark it INVOICED. */
export async function convertSalesOrderToInvoiceAction(id: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
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

    // Link invoice→order so deleting the draft invoice can reopen the order (Audit#7).
    // Carry the order's shipping too — createSalesInvoiceAction totals only the
    // lines, so without this the invoice bills less than the order total forever.
    const shipping = Number(so.shippingAmount) || 0;
    if (r.id) await db.update(salesInvoices).set({
      salesOrderId: so.id,
      ...(shipping > 0 ? {
        shippingAmount: String(shipping),
        totalAmount: sql`${salesInvoices.totalAmount} + ${shipping}`,
        balanceDue: sql`${salesInvoices.balanceDue} + ${shipping}`,
      } : {}),
    }).where(and(eq(salesInvoices.id, r.id), eq(salesInvoices.organizationId, auth.orgId)));
    await db.update(salesOrders).set({ status: "INVOICED" }).where(eq(salesOrders.id, so.id));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONVERT", entityType: "SALES_ORDER", entityId: so.id, entityNumber: so.number, summary: `تحويل أمر بيع ${so.number} إلى فاتورة (مسودة)` });
    revalidatePath("/sales/orders");
    revalidatePath("/sales/invoices");
    return { ok: true, invoiceId: r.id };
  });
}

/**
 * Bulk confirm / cancel / delete selected sales orders. Each id is checked
 * against the op's precondition (confirm/delete need DRAFT; cancel needs a
 * non-invoiced, non-cancelled order) and skipped otherwise.
 */
/** Mirrors the list page's filters — the "select all pages" path re-derives the
 *  ids from these SERVER-SIDE so the client never ships thousands of ids. */
export type SalesOrdersFilter = { q?: string; status?: string; customer?: string; from?: string; to?: string };

async function matchingSalesOrderIds(orgId: string, f: SalesOrdersFilter): Promise<string[]> {
  const conds = [eq(salesOrders.organizationId, orgId)];
  if (f.q) conds.push(or(ilike(salesOrders.number, `%${f.q}%`), ilike(salesOrders.externalOrderId, `%${f.q}%`))!);
  if (f.status) conds.push(eq(salesOrders.status, f.status));
  if (f.customer) conds.push(eq(salesOrders.customerId, f.customer));
  if (f.from) conds.push(gte(salesOrders.date, new Date(f.from)));
  if (f.to) conds.push(lte(salesOrders.date, new Date(f.to + "T23:59:59")));
  return (await db.select({ id: salesOrders.id }).from(salesOrders).where(and(...conds))).map((r) => r.id);
}

export async function bulkSalesOrdersAction(op: "confirm" | "cancel" | "delete" | "deliver", ids: string[], all?: SalesOrdersFilter): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" || op === "deliver" ? "sales.create" : "sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    if (all) ids = await matchingSalesOrderIds(auth.orgId, all);
    if (!ids.length) return { error: "لم تحدّد أي أمر" };

    // "All pages" can be thousands of rows — run set-based (same guards as the
    // per-row branch below) with ONE summary audit instead of looping.
    // deliver creates a DRAFT إذن صرف per order, so it must loop the guarded
    // action (which skips anything not CONFIRMED/PARTIALLY_DELIVERED).
    if (all && op === "deliver") {
      let count = 0;
      for (const id of ids) {
        const r = await createDeliveryFromOrderAction(id);
        if (r.ok) count++;
      }
      revalidatePath("/sales/orders");
      revalidatePath("/sales/deliveries");
      return { ok: true, count };
    }
    if (all) {
      let count = 0;
      if (op === "confirm") {
        const r = await db.update(salesOrders).set({ status: "CONFIRMED" })
          .where(and(eq(salesOrders.organizationId, auth.orgId), inArray(salesOrders.id, ids), eq(salesOrders.status, "DRAFT")))
          .returning({ id: salesOrders.id });
        count = r.length;
      } else if (op === "delete") {
        const r = await db.delete(salesOrders)
          .where(and(eq(salesOrders.organizationId, auth.orgId), inArray(salesOrders.id, ids), eq(salesOrders.status, "DRAFT")))
          .returning({ id: salesOrders.id });
        count = r.length;
      } else {
        // cancel: skip anything already delivered/invoiced (posted stock/COGS).
        const r = await db.update(salesOrders).set({ status: "CANCELLED" })
          .where(and(
            eq(salesOrders.organizationId, auth.orgId), inArray(salesOrders.id, ids),
            sql`${salesOrders.status} not in ('INVOICED', 'CANCELLED')`,
            sql`not exists (select 1 from sales_order_lines l where l.sales_order_id = ${salesOrders.id} and (l.delivered_qty > 0 or l.invoiced_qty > 0))`,
          ))
          .returning({ id: salesOrders.id });
        count = r.length;
      }
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: op === "confirm" ? "CONFIRM" : op === "cancel" ? "CANCEL" : "DELETE", entityType: "SALES_ORDER", entityId: "bulk", summary: `عملية جماعية (${op}) على ${count} أمر بيع عبر كل الصفحات` });
      revalidatePath("/sales/orders");
      return { ok: true, count };
    }

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
        // Same guard as cancelSalesOrderAction: a part-delivered/part-invoiced order
        // carries posted stock/COGS a cancel does not reverse — skip it, don't cancel.
        const moved = await db.select({ d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
          .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
        if (moved.some((l) => Number(l.d) > 0 || Number(l.inv) > 0)) continue;
        await db.update(salesOrders).set({ status: "CANCELLED" }).where(eq(salesOrders.id, id));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `إلغاء أمر بيع ${so.number}` });
        count++;
      } else if (op === "delete" && so.status === "DRAFT") {
        await db.delete(salesOrders).where(eq(salesOrders.id, id));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `حذف مسودة أمر بيع ${so.number}` });
        count++;
      } else if (op === "deliver" && (so.status === "CONFIRMED" || so.status === "PARTIALLY_DELIVERED")) {
        // One DRAFT إذن صرف per order for the full remaining qty (no posting).
        const r = await createDeliveryFromOrderAction(id);
        if (r.ok) count++;
      }
    }
    revalidatePath("/sales/orders");
    revalidatePath("/sales/deliveries");
    return { ok: true, count };
  });
}

/** Cancel a sales order (only before it is invoiced). */
export async function cancelSalesOrderAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) return { error: "الأمر غير موجود" };
    if (so.status === "INVOICED") return { error: "لا يمكن إلغاء أمر محوّل لفاتورة" };
    // Cancelling says the order never happened, so it cannot be squared with stock
    // that has already shipped or been invoiced — those post COGS/revenue that a
    // cancel does not reverse. Blocking INVOICED alone missed the partial case: a
    // part-delivered order never reaches INVOICED, so it slipped through and left a
    // CANCELLED order carrying posted movements. Same rule revertToDraft uses.
    const moved = await db.select({ d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
      .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    if (moved.some((l) => Number(l.d) > 0 || Number(l.inv) > 0)) {
      return { error: "الأمر مصروف/مفوتر جزئيًا — اعكس الصرف أو أنشئ مرتجعًا بدل الإلغاء" };
    }
    const cancelled = await db.update(salesOrders).set({ status: "CANCELLED" })
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.status, so.status)))
      .returning({ id: salesOrders.id });
    if (!cancelled.length) return { error: "تغيّرت حالة الأمر — حدّث الصفحة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `إلغاء أمر بيع ${so.number}` });
    revalidatePath("/sales/orders");
    return { ok: true };
  });
}

/** Reopen a CONFIRMED sales order back to DRAFT (only when nothing delivered/invoiced). */
export async function revertSalesOrderToDraftAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) return { error: "الأمر غير موجود" };
    if (so.status !== "CONFIRMED") return { error: "يمكن إعادة فتح أمر مؤكّد فقط" };
    const lines = await db.select({ d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
      .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id));
    if (lines.some((l) => Number(l.d) > 0 || Number(l.inv) > 0)) return { error: "اعكس الصرف/الفاتورة أولاً قبل إعادة فتح الأمر" };
    await db.update(salesOrders).set({ status: "DRAFT" }).where(eq(salesOrders.id, id));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `إعادة فتح أمر بيع ${so.number} كمسودة` });
    revalidatePath("/sales/orders");
    revalidatePath(`/sales/orders/${encodeURIComponent(so.number)}`);
    return { ok: true };
  });
}
