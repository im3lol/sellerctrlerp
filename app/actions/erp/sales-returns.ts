"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesReturns, salesReturnLines, salesInvoices, salesInvoiceLines, customers, warehouses, journalEntries, stockMovements, stockMovementBatches, deliveryNotes, deliveryNoteLines, salesOrderLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { recomputeSalesOrderStatus } from "@/lib/erp/sales-order";

export type SaveReturnState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});
const schema = z.object({
  salesInvoiceId: z.string().min(1, "اختر الفاتورة"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "SR", year);
}

/**
 * Create a sales return (credit note) as a DRAFT — header + lines only.
 * No GL, no stock, no balance change until it is confirmed.
 */
export async function createSalesReturnAction(input: unknown): Promise<SaveReturnState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { salesInvoiceId, date, notes, lines } = parsed.data;

  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.id, salesInvoiceId), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  // Validate returned quantities against the invoice lines.
  const invLines = await db.select({ itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity })
    .from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
  const soldByItem = new Map<string, number>();
  for (const l of invLines) soldByItem.set(l.itemId, (soldByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  for (const l of lines) {
    if ((l.quantity) > (soldByItem.get(l.itemId) ?? 0) + 1e-9) {
      return { error: "الكمية المرتجعة أكبر من المباعة" };
    }
  }

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);

  // Trace the originating order (via the invoice's delivery) so the return also shows under the order.
  let orderId: string | null = null;
  if (inv.deliveryNoteId) {
    const [d2] = await db.select({ soId: deliveryNotes.salesOrderId }).from(deliveryNotes).where(eq(deliveryNotes.id, inv.deliveryNoteId)).limit(1);
    orderId = d2?.soId ?? null;
  }

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(salesReturns).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT",
        customerId: inv.customerId, warehouseId: wh?.id ?? "", salesInvoiceId: inv.id, salesOrderId: orderId,
        totalAmount: String(total), notes: notes || null,
      }).returning({ id: salesReturns.id });

      await tx.insert(salesReturnLines).values(lines.map((l) => ({
        salesReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity),
        unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));
      return ret.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_RETURN", entityId: id, entityNumber: number, summary: `إنشاء مرتجع مبيعات ${number} (مسودة)`, metadata: { total, invoice: inv.number } });
    revalidatePath("/erp/sales/invoices");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ المرتجع" };
  }
}

/**
 * Confirm (post) a DRAFT sales return — atomic + idempotent:
 *   Dr مردودات المبيعات (4102) = net · Dr ضريبة المخرجات (2102) = tax · Cr العملاء (1103) = total
 *   + restock at WAC and reverse COGS: Dr المخزون (1104) · Cr ت.ب.م (5101)
 *   + reduce the customer balance. Sets status = POSTED.
 */
export async function confirmSalesReturnAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const [ret] = await db.select().from(salesReturns)
    .where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, auth.orgId))).limit(1);
  if (!ret) return { error: "المرتجع غير موجود" };
  if (ret.status !== "DRAFT") return { error: "المرتجع مُرحّل بالفعل" };

  // Delivery return (stock side): restock + Dr 1104 / Cr 5101 (reverse COGS), drop deliveredQty.
  if (ret.deliveryNoteId) {
    const [dn] = await db.select().from(deliveryNotes).where(eq(deliveryNotes.id, ret.deliveryNoteId)).limit(1);
    if (!dn) return { error: "إذن الصرف غير موجود" };
    const rLines = await db.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity, unitPrice: salesReturnLines.unitPrice })
      .from(salesReturnLines).where(eq(salesReturnLines.salesReturnId, id));
    if (rLines.length === 0) return { error: "لا توجد بنود في المرتجع" };
    const net = round2(rLines.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0));
    const A = await resolveAccountIds(auth.orgId, ["1104", "5101"]);
    if (!A["1104"] || !A["5101"]) return { error: "حسابات الترحيل غير مكتملة." };
    const soLines = dn.salesOrderId
      ? await db.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, dn.salesOrderId))
      : [];
    const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
    const d = ret.date instanceof Date ? ret.date : new Date(ret.date);
    try {
      await db.transaction(async (tx) => {
        for (const l of rLines) {
          const q = Number(l.quantity);
          await postStockMovement(tx, { orgId: auth.orgId, itemId: l.itemId, warehouseId: dn.warehouseId, type: "IN", quantity: q, unitCost: Number(l.unitPrice), date: d, referenceType: "SALES_RETURN", referenceId: ret.id, reason: `مرتجع إذن صرف ${dn.number}` });
          const sol = soByItem.get(l.itemId);
          if (sol) await tx.update(salesOrderLines).set({ deliveredQty: sql`GREATEST(0, ${salesOrderLines.deliveredQty} - ${q})` }).where(eq(salesOrderLines.id, sol.id));
        }
        await postEntry(tx, { orgId: auth.orgId, date: d, sourceType: "SALES_RETURN", sourceId: ret.id, description: `مرتجع إذن صرف ${dn.number}`, journalType: "GENERAL", userId: auth.userId, lines: [
          { accountId: A["1104"], debit: net, credit: 0, description: `إرجاع مخزون ${ret.number}` },
          { accountId: A["5101"], debit: 0, credit: net, description: `عكس ت.ب.م ${ret.number}` },
        ] });
        if (dn.salesOrderId) await recomputeSalesOrderStatus(tx, dn.salesOrderId);
        await tx.update(salesReturns).set({ status: "POSTED" }).where(eq(salesReturns.id, ret.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "SALES_RETURN", entityId: ret.id, entityNumber: ret.number, summary: `تأكيد مرتجع إذن صرف ${dn.number}`, metadata: { net } });
      });
      revalidatePath("/erp/sales/deliveries");
      revalidatePath("/erp/sales/orders");
      revalidatePath("/erp/accounting/journal");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر ترحيل المرتجع" };
    }
  }

  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.id, ret.salesInvoiceId ?? ""), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  const retLines = await db.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity, unitPrice: salesReturnLines.unitPrice })
    .from(salesReturnLines).where(eq(salesReturnLines.salesReturnId, id));
  if (retLines.length === 0) return { error: "لا توجد بنود في المرتجع" };
  const lines = retLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const A = await resolveAccountIds(auth.orgId, ["4102", "2102", "1103", "1104", "5101"]);
  if (!A["4102"] || !A["1103"]) return { error: "حسابات الترحيل غير مكتملة (مردودات/العملاء)." };

  const whId = ret.warehouseId;
  const d = ret.date instanceof Date ? ret.date : new Date(ret.date);

  try {
    await db.transaction(async (tx) => {
      // Revenue + VAT reversal.
      const revLines = [
        { accountId: A["4102"], debit: net, credit: 0, description: `مرتجع ${ret.number}` },
        { accountId: A["1103"], debit: 0, credit: total, description: `إشعار دائن ${inv.number}` },
      ];
      if (tax > 0 && A["2102"]) revLines.splice(1, 0, { accountId: A["2102"], debit: tax, credit: 0, description: `عكس ضريبة ${ret.number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "SALES_RETURN", sourceId: ret.id,
        description: `مرتجع مبيعات ${ret.number} — فاتورة ${inv.number}`, journalType: "SALES", userId: auth.userId, lines: revLines,
      });

      // Restock + reverse COGS ONLY for a standalone invoice (no delivery). When the
      // invoice was billed from a delivery, the stock side is handled by the
      // delivery's own return (مرتجع إذن الصرف) — this credit note is money-only.
      let cogs = 0;
      if (!inv.deliveryNoteId && whId && A["1104"] && A["5101"]) {
        for (const l of lines) {
          const { avgCost } = await currentStock(auth.orgId, l.itemId, whId, tx);
          const r = await postStockMovement(tx, {
            orgId: auth.orgId, itemId: l.itemId, warehouseId: whId, type: "IN",
            quantity: l.quantity, unitCost: avgCost, date: d,
            referenceType: "SALES_RETURN", referenceId: ret.id, reason: `مرتجع بيع ${ret.number}`,
          });
          cogs += r.totalCost;
        }
        if (cogs > 0) {
          await postEntry(tx, {
            orgId: auth.orgId, date: d, sourceType: "SALES_RETURN_COGS", sourceId: ret.id,
            description: `عكس ت.ب.م مرتجع ${ret.number}`, journalType: "GENERAL",
            lines: [
              { accountId: A["1104"], debit: cogs, credit: 0, description: `إرجاع مخزون ${ret.number}` },
              { accountId: A["5101"], debit: 0, credit: cogs, description: `عكس ت.ب.م ${ret.number}` },
            ],
          });
        }
      }

      await tx.update(customers).set({ balance: sql`${customers.balance} - ${total}` }).where(eq(customers.id, ret.customerId));
      await tx.update(salesReturns).set({ status: "POSTED" }).where(eq(salesReturns.id, ret.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "SALES_RETURN", entityId: ret.id, entityNumber: ret.number, summary: `تأكيد وترحيل مرتجع مبيعات ${ret.number}`, metadata: { total, invoice: inv.number } });
    });

    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل المرتجع" };
  }
}

export type ReturnPick = { itemId: string; quantity: number; unitPrice: number };

/**
 * One-shot return from a posted sales invoice: create the credit-note draft for
 * the picked quantities and immediately confirm (post) it. Used by the "مرتجع"
 * shortcut on the invoice page.
 */
export async function returnFromSalesInvoiceAction(invoiceId: string, picks: ReturnPick[], date?: string): Promise<ActionState & { id?: string }> {
  const lines = picks.filter((p) => p.quantity > 0);
  if (lines.length === 0) return { error: "حدّد كمية مرتجعة لبند واحد على الأقل" };
  const created = await createSalesReturnAction({ salesInvoiceId: invoiceId, date: date || new Date().toISOString().slice(0, 10), lines });
  if (!created.ok || !created.id) return created;
  const posted = await confirmSalesReturnAction(created.id);
  if (!posted.ok) return { error: posted.error, id: created.id };
  revalidatePath("/erp/sales/invoices");
  return { ok: true, id: created.id };
}

/** Delete a DRAFT sales return (header + lines). Posted returns are immutable. */
export async function deleteSalesReturnAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const [ret] = await db.select({ status: salesReturns.status }).from(salesReturns)
    .where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, auth.orgId))).limit(1);
  if (!ret) return { error: "المرتجع غير موجود" };
  if (ret.status !== "DRAFT") return { error: "لا يمكن حذف مرتجع مُرحّل" };

  await db.transaction(async (tx) => {
    await tx.delete(salesReturnLines).where(eq(salesReturnLines.salesReturnId, id));
    await tx.delete(salesReturns).where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, auth.orgId)));
  });

  revalidatePath("/erp/sales/invoices");
  return { ok: true };
}

/**
 * Cancel a POSTED sales return: reverse its GL entries (revenue/VAT + any COGS),
 * undo any restock, restore the customer balance, and mark it CANCELLED.
 */
export async function reverseSalesReturnAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  const [ret] = await db.select().from(salesReturns)
    .where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, auth.orgId))).limit(1);
  if (!ret) return { error: "المرتجع غير موجود" };
  if (ret.status !== "POSTED") return { error: "يمكن إلغاء مرتجع مُرحّل فقط" };
  const total = Number(ret.totalAmount);
  const d = new Date();
  try {
    await db.transaction(async (tx) => {
      const entries = await tx.select({ id: journalEntries.id }).from(journalEntries)
        .where(and(eq(journalEntries.organizationId, auth.orgId), inArray(journalEntries.sourceType, ["SALES_RETURN", "SALES_RETURN_COGS"]), eq(journalEntries.sourceId, ret.id), eq(journalEntries.status, "POSTED")));
      for (const e of entries) await reverseEntry(tx, { orgId: auth.orgId, entryId: e.id, date: d, userId: auth.userId, reason: `إلغاء مرتجع ${ret.number}` });

      const moves = await tx.select({ id: stockMovements.id, itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost, type: stockMovements.type, warehouseId: stockMovements.warehouseId })
        .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "SALES_RETURN"), eq(stockMovements.referenceId, ret.id)));
      for (const m of moves) {
        const smb = await tx.select({ batchId: stockMovementBatches.batchId, quantity: stockMovementBatches.quantity }).from(stockMovementBatches).where(eq(stockMovementBatches.movementId, m.id));
        await postStockMovement(tx, { orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId, type: m.type === "IN" ? "OUT" : "IN", quantity: Number(m.quantity), unitCost: Number(m.unitCost), date: d, allocations: smb.map((s) => ({ batchId: s.batchId, quantity: Math.abs(Number(s.quantity)) })), referenceType: "SALES_RETURN_CANCEL", referenceId: ret.id, reason: `إلغاء مرتجع ${ret.number}` });
      }

      if (ret.deliveryNoteId) {
        // Delivery (stock) return: no AR impact — restore the order's deliveredQty instead.
        if (ret.salesOrderId) {
          const rLines = await tx.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity }).from(salesReturnLines).where(eq(salesReturnLines.salesReturnId, ret.id));
          const soLines = await tx.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, ret.salesOrderId));
          const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
          for (const l of rLines) { const sol = soByItem.get(l.itemId); if (sol) await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${Number(l.quantity)}` }).where(eq(salesOrderLines.id, sol.id)); }
          await recomputeSalesOrderStatus(tx, ret.salesOrderId);
        }
      } else if (ret.customerId) {
        await tx.update(customers).set({ balance: sql`${customers.balance} + ${total}` }).where(eq(customers.id, ret.customerId));
      }
      await tx.update(salesReturns).set({ status: "CANCELLED" }).where(eq(salesReturns.id, ret.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "SALES_RETURN", entityId: ret.id, entityNumber: ret.number, summary: `إلغاء مرتجع مبيعات ${ret.number}`, metadata: { total } });
    });
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إلغاء المرتجع" };
  }
}

const deliveryReturnSchema = z.object({
  deliveryNoteId: z.string().min(1, "اختر الإذن"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

/** Create a stock return from a delivery note as a DRAFT (salesReturns.deliveryNoteId). */
export async function createDeliveryReturnAction(input: unknown): Promise<SaveReturnState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const parsed = deliveryReturnSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { deliveryNoteId, date, notes, lines } = parsed.data;

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryNoteId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "إذن الصرف غير موجود" };
  if (dn.status !== "DELIVERED" && dn.status !== "INVOICED") return { error: "لا يمكن الإرجاع من هذا الإذن" };
  if (!dn.customerId) return { error: "الإذن غير مرتبط بعميل" };

  // remaining = delivered − already returned (posted), per item.
  const dnLines = await db.select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity })
    .from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, dn.id));
  const deliveredByItem = new Map<string, number>();
  for (const l of dnLines) deliveredByItem.set(l.itemId, (deliveredByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  const prior = await db.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity })
    .from(salesReturnLines).innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
    .where(and(eq(salesReturns.deliveryNoteId, dn.id), eq(salesReturns.status, "POSTED")));
  const returnedByItem = new Map<string, number>();
  for (const l of prior) returnedByItem.set(l.itemId, (returnedByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  for (const l of lines) {
    const remaining = (deliveredByItem.get(l.itemId) ?? 0) - (returnedByItem.get(l.itemId) ?? 0);
    if (l.quantity > remaining + 1e-9) return { error: "الكمية المرتجعة أكبر من المتبقّي للصنف" };
  }

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(salesReturns).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT",
        customerId: dn.customerId!, warehouseId: dn.warehouseId, deliveryNoteId: dn.id, salesOrderId: dn.salesOrderId,
        totalAmount: String(net), notes: notes || null,
      }).returning({ id: salesReturns.id });
      await tx.insert(salesReturnLines).values(lines.map((l) => ({
        salesReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));
      return ret.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_RETURN", entityId: id, entityNumber: number, summary: `مرتجع إذن صرف ${dn.number} (مسودة)`, metadata: { net } });
    revalidatePath("/erp/sales/deliveries");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ المرتجع" };
  }
}
