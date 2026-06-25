"use server";

import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  deliveryNotes, deliveryNoteLines, salesOrders, salesOrderLines,
  salesInvoices, salesInvoiceLines, items, stockMovements, stockMovementBatches, warehouses,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputeSalesOrderStatus } from "@/lib/erp/sales-order";

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

export type Pick = { itemId: string; quantity: number; warehouseId?: string };

export type DeliverableLine = {
  itemId: string; code: string; name: string; ordered: number; delivered: number; remaining: number;
  warehouseId: string | null; stockByWarehouse: Record<string, number>;
};

/**
 * Recall a confirmed/partial sales order's still-undelivered lines for the
 * delivery form: remaining qty + current on-hand per warehouse per item.
 */
export async function getDeliverableOrderLinesAction(salesOrderId: string): Promise<
  ActionState & { lines?: DeliverableLine[]; defaultWarehouseId?: string }
> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };

  const ols = await db
    .select({ itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity, deliveredQty: salesOrderLines.deliveredQty, warehouseId: salesOrderLines.warehouseId, code: items.code, name: items.nameAr })
    .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, so.id));

  const lines = ols
    .map((l) => {
      const ordered = Number(l.quantity), delivered = Number(l.deliveredQty);
      return { itemId: l.itemId, code: l.code ?? "", name: l.name ?? "", ordered, delivered, remaining: round2(ordered - delivered), warehouseId: l.warehouseId, stockByWarehouse: {} as Record<string, number> };
    })
    .filter((l) => l.remaining > EPS);

  const itemIds = lines.map((l) => l.itemId);
  if (itemIds.length) {
    const sm = await db
      .select({ itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, bal: stockMovements.balanceQuantity })
      .from(stockMovements)
      .where(and(eq(stockMovements.organizationId, auth.orgId), inArray(stockMovements.itemId, itemIds)))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id));
    const seen = new Set<string>();
    const byItem = new Map(lines.map((l) => [l.itemId, l]));
    for (const m of sm) {
      const key = `${m.itemId}|${m.warehouseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = byItem.get(m.itemId);
      if (line) line.stockByWarehouse[m.warehouseId] = Number(m.bal);
    }
  }

  // Default warehouse = first active (delivery issues from one).
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);
  return { ok: true, lines, defaultWarehouseId: wh?.id };
}

/**
 * Save a delivery as a DRAFT from a confirmed/partial sales order — no stock, no
 * COGS, the order is NOT advanced (save → draft, confirm → post). `picks` set the
 * delivered quantity per item (≤ remaining) with an optional per-line
 * `warehouseId`. `date` is the delivery date. Confirm later to post.
 */
export async function createDeliveryFromOrderAction(salesOrderId: string, picks?: Pick[], date?: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "CONFIRMED" && so.status !== "PARTIALLY_DELIVERED") return { error: "يمكن التسليم من أمر مؤكّد أو منفّذ جزئياً فقط" };

  const orderLines = await db.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity, deliveredQty: salesOrderLines.deliveredQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));

  const pickBy = new Map((picks ?? []).map((p) => [p.itemId, p]));
  const toDeliver: { itemId: string; qty: number; warehouseId: string | null }[] = [];
  for (const l of orderLines) {
    const remaining = round2(Number(l.quantity) - Number(l.deliveredQty));
    const p = picks ? pickBy.get(l.itemId) : undefined;
    const want = picks ? (p?.quantity ?? 0) : remaining;
    if (want < -EPS) return { error: "كمية غير صالحة" };
    if (want > remaining + EPS) return { error: "الكمية المسلّمة أكبر من المتبقّي للصنف" };
    if (want > EPS) toDeliver.push({ itemId: l.itemId, qty: round2(want), warehouseId: p?.warehouseId || null });
  }
  if (toDeliver.length === 0) return { error: "لا توجد كميات للتسليم" };

  // Header warehouse = first line's warehouse, else any active warehouse.
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);
  const headerWh = toDeliver.find((t) => t.warehouseId)?.warehouseId || wh?.id;
  if (!headerWh) return { error: "لا يوجد مستودع" };

  const deliveryDate = date ? new Date(date) : new Date(so.date);
  const number = await nextNumber("DLV", auth.orgId, deliveryDate.getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [dn] = await tx.insert(deliveryNotes).values({
        organizationId: auth.orgId, number, date: deliveryDate, status: "DRAFT",
        salesOrderId: so.id, customerId: so.customerId, warehouseId: headerWh, notes: `تسليم أمر ${so.number}`,
      }).returning({ id: deliveryNotes.id });
      await tx.insert(deliveryNoteLines).values(toDeliver.map((t) => ({
        deliveryNoteId: dn.id, itemId: t.itemId, warehouseId: t.warehouseId ?? headerWh, quantity: String(t.qty),
      })));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "DELIVERY_NOTE", entityId: dn.id, entityNumber: number, summary: `حفظ مسودة إذن صرف ${number} من أمر بيع ${so.number}` });
      return dn.id;
    });
    revalidatePath("/erp/sales/deliveries");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ التسليم" };
  }
}

/**
 * Confirm a DRAFT delivery → POST it: issue stock OUT at WAC + Dr COGS (5101) /
 * Cr Inventory (1104), advance the order's deliveredQty, recompute the order
 * status, link + audit, flip DRAFT → DELIVERED. Re-validates ≤ remaining.
 */
export async function confirmDeliveryAction(deliveryId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  if (dn.status !== "DRAFT") return { error: "تم تأكيد التسليم بالفعل" };
  if (!dn.salesOrderId) return { error: "التسليم غير مرتبط بأمر بيع" };

  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId)).limit(1);
  if (!so) return { error: "أمر البيع غير موجود" };

  const dnLines = await db.select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity, warehouseId: deliveryNoteLines.warehouseId })
    .from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, dn.id));
  const soLines = await db.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity, deliveredQty: salesOrderLines.deliveredQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  const soByItem = new Map(soLines.map((l) => [l.itemId, l]));

  for (const dl of dnLines) {
    const sol = soByItem.get(dl.itemId);
    if (!sol) return { error: "أحد الأصناف غير موجود في أمر البيع" };
    const remaining = round2(Number(sol.quantity) - Number(sol.deliveredQty));
    if (Number(dl.quantity) > remaining + EPS) return { error: "الكمية المسلّمة لأحد الأصناف أكبر من المتبقّي — عدّل المسودة" };
  }

  const A = await resolveAccountIds(auth.orgId, ["5101", "1104"]);

  const deliveryDate = new Date(dn.date);
  try {
    await db.transaction(async (tx) => {
      let cogs = 0;
      for (const dl of dnLines) {
        const qty = Number(dl.quantity);
        if (qty <= EPS) continue;
        const r = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: dl.itemId, warehouseId: dl.warehouseId || dn.warehouseId, type: "OUT",
          quantity: qty, date: deliveryDate, referenceType: "DELIVERY", referenceId: dn.id, reason: `تسليم ${dn.number}`,
        });
        cogs += r.totalCost;
        const sol = soByItem.get(dl.itemId)!;
        await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${qty}` }).where(eq(salesOrderLines.id, sol.id));
      }
      cogs = round2(cogs);
      if (cogs > 0 && A["5101"] && A["1104"]) {
        await postEntry(tx, {
          orgId: auth.orgId, date: deliveryDate, sourceType: "DELIVERY_COGS", sourceId: dn.id,
          description: `ت.ب.م تسليم ${dn.number}`, journalType: "GENERAL", userId: auth.userId,
          lines: [
            { accountId: A["5101"], debit: cogs, credit: 0, description: `ت.ب.م ${dn.number}` },
            { accountId: A["1104"], debit: 0, credit: cogs, description: `صرف مخزون ${dn.number}` },
          ],
        });
      }
      await tx.update(deliveryNotes).set({ status: "DELIVERED" }).where(eq(deliveryNotes.id, dn.id));
      const newStatus = await recomputeSalesOrderStatus(tx, so.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "SALES_ORDER", fromId: so.id, fromNumber: so.number, toType: "DELIVERY_NOTE", toId: dn.id, toNumber: dn.number, relation: "FULFILLS" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "DELIVERY_NOTE", entityId: dn.id, entityNumber: dn.number, summary: `تأكيد إذن صرف ${dn.number} من أمر بيع ${so.number} (${newStatus === "DELIVERED" ? "كامل" : "جزئي"})`, metadata: { cogs } });
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/orders");
    revalidatePath(`/erp/sales/deliveries/${dn.number}`);
    return { ok: true, id: dn.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تأكيد التسليم" };
  }
}

/** Delete a DRAFT delivery (nothing posted yet). Confirmed deliveries are immutable. */
export async function deleteDeliveryAction(deliveryId: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  if (dn.status !== "DRAFT") return { error: "لا يمكن حذف إذن صرف مؤكّد" };
  try {
    await db.transaction(async (tx) => {
      await tx.delete(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, dn.id));
      await tx.delete(deliveryNotes).where(eq(deliveryNotes.id, dn.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "DELIVERY_NOTE", entityId: dn.id, entityNumber: dn.number, summary: `حذف مسودة إذن صرف ${dn.number}` });
    });
    revalidatePath("/erp/sales/deliveries");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
  }
}

/** Bulk confirm / bill / delete deliveries. Skips rows ineligible for the op. */
export async function bulkDeliveriesAction(op: "confirm" | "bill" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "sales.create" : "sales.confirm");
  if ("error" in auth) return auth;
  if (!ids.length) return { error: "لم تُحدّد أي إذون" };
  let count = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = op === "confirm" ? await confirmDeliveryAction(id)
      : op === "bill" ? await convertDeliveryToInvoiceAction(id)
      : await deleteDeliveryAction(id);
    if (r.ok) count++;
    else lastError = r.error;
  }
  if (count === 0) return { error: lastError ?? "تعذّر التنفيذ" };
  return { ok: true, count };
}

export type DeliveryInvoiceLine = { itemId: string; code: string; name: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number; totalAmount: number };
export type DeliveryInvoicePreview = { lines: DeliveryInvoiceLine[]; subtotal: number; discount: number; tax: number; total: number };

/** Compute the invoice a delivery would produce (priced from the order). */
async function buildDeliveryInvoice(dn: typeof deliveryNotes.$inferSelect): Promise<DeliveryInvoicePreview | { error: string }> {
  if (!dn.salesOrderId) return { error: "التسليم غير مرتبط بأمر بيع" };
  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId)).limit(1);
  if (!so) return { error: "أمر البيع غير موجود" };
  const soLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
  const dnLines = await db.select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity, code: items.code, name: items.nameAr })
    .from(deliveryNoteLines).leftJoin(items, eq(items.id, deliveryNoteLines.itemId))
    .where(eq(deliveryNoteLines.deliveryNoteId, dn.id));

  const lines: DeliveryInvoiceLine[] = [];
  let subtotal = 0, discount = 0, tax = 0;
  for (const dl of dnLines) {
    const so2 = soByItem.get(dl.itemId);
    if (!so2) continue;
    const dq = Number(dl.quantity);
    if (dq <= EPS) continue;
    const oq = Number(so2.quantity) || dq;
    const f = oq > 0 ? dq / oq : 0;
    const price = Number(so2.unitPrice);
    const lineDisc = round2(Number(so2.discountAmount) * f);
    const lineTax = round2(Number(so2.taxAmount) * f);
    const lineTotal = round2(price * dq - lineDisc + lineTax);
    subtotal += price * dq; discount += lineDisc; tax += lineTax;
    lines.push({ itemId: dl.itemId, code: dl.code ?? "", name: dl.name ?? "", quantity: dq, unitPrice: price, discountAmount: lineDisc, taxAmount: lineTax, totalAmount: lineTotal });
  }
  subtotal = round2(subtotal); discount = round2(discount); tax = round2(tax);
  return { lines, subtotal, discount, tax, total: round2(subtotal - discount + tax) };
}

/** Preview the invoice a confirmed delivery would produce (for the create form). */
export async function getDeliveryInvoicePreviewAction(deliveryId: string): Promise<ActionState & { preview?: DeliveryInvoicePreview }> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return auth;
  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  const built = await buildDeliveryInvoice(dn);
  if ("error" in built) return built;
  return { ok: true, preview: built };
}

/**
 * Bill a confirmed delivery → a DRAFT sales invoice for the delivered quantities
 * (priced from the order, discount/tax pro-rated). No GL until the invoice is
 * posted — posting recognises revenue/AR only (stock + COGS already done at
 * delivery). `date`/`notes` optional.
 */
export async function convertDeliveryToInvoiceAction(
  deliveryId: string,
  date?: string,
  notes?: string,
  currencyCode?: string,
  exchangeRate?: number,
): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  if (dn.status === "DRAFT") return { error: "أكّد إذن الصرف أولاً قبل تحويله إلى فاتورة" };
  if (dn.salesInvoiceId) return { error: "التسليم مفوتر بالفعل" };
  const customerId = dn.customerId;
  if (!customerId) return { error: "التسليم غير مرتبط بعميل" };

  const [existing] = await db.select({ id: salesInvoices.id }).from(salesInvoices)
    .where(and(eq(salesInvoices.deliveryNoteId, dn.id), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
  if (existing) return { error: "لهذا التسليم فاتورة بالفعل (مسودة أو مرحّلة)" };

  const built = await buildDeliveryInvoice(dn);
  if ("error" in built) return built;
  if (built.total <= 0) return { error: "لا توجد كميات قابلة للفوترة" };

  const invoiceDate = date ? new Date(date) : new Date(dn.date);
  const number = await nextNumber("SI", auth.orgId, invoiceDate.getFullYear());

  // Multi-currency: delivery amounts are in base currency (SAR).
  // If the user selects a foreign currency, foreignAmount = total / rate (display only).
  const code = (currencyCode ?? "SAR").toUpperCase();
  const rate = exchangeRate && exchangeRate > 0 ? exchangeRate : 1;
  const foreignTotalAmount = code !== "SAR" ? Math.round((built.total / rate) * 10000) / 10000 : null;

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: auth.orgId, number, customerId, deliveryNoteId: dn.id, date: invoiceDate, status: "DRAFT",
        subtotal: String(built.subtotal), discountAmount: String(built.discount), taxAmount: String(built.tax), totalAmount: String(built.total),
        paidAmount: "0", balanceDue: String(built.total), notes: notes || `فاتورة تسليم ${dn.number}`,
        currencyCode: code,
        exchangeRate: String(rate),
        foreignAmount: foreignTotalAmount !== null ? String(foreignTotalAmount) : null,
      }).returning({ id: salesInvoices.id });
      await tx.insert(salesInvoiceLines).values(built.lines.map((l) => ({
        salesInvoiceId: inv.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_INVOICE", entityId: inv.id, entityNumber: number, summary: `مسودة فاتورة بيع ${number} من إذن صرف ${dn.number}`, metadata: { total: built.total } });
      return inv.id;
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/invoices");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}

/**
 * Fully reverse a confirmed, UN-invoiced delivery ("عكس الصرف"): restock at the
 * original delivery cost + Dr 1104 / Cr 5101 (reverse COGS), drop the order's
 * deliveredQty so it reopens, mark the delivery REVERSED. Invoiced deliveries
 * must use the invoice return.
 */
export async function reverseDeliveryAction(deliveryId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "الإذن غير موجود" };
  // Stock-side return: available whether or not the delivery was invoiced (the
  // money side is handled separately by the invoice return).
  if (dn.status !== "DELIVERED" && dn.status !== "INVOICED") return { error: "لا يمكن عكس هذا الإذن" };

  const moves = await db.select({ id: stockMovements.id, itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "DELIVERY"), eq(stockMovements.referenceId, dn.id)));
  if (moves.length === 0) return { error: "لا توجد حركة مخزون للعكس" };

  const A = await resolveAccountIds(auth.orgId, ["5101", "1104"]);
  if (!A["5101"] || !A["1104"]) return { error: "حسابات العكس غير مكتملة" };

  const soLines = dn.salesOrderId
    ? await db.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, dn.salesOrderId))
    : [];
  const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
  const date = new Date();

  try {
    await db.transaction(async (tx) => {
      let cogs = 0;
      for (const m of moves) {
        const qty = Number(m.quantity), cost = Number(m.unitCost);
        const smb = await tx.select({ batchId: stockMovementBatches.batchId, quantity: stockMovementBatches.quantity }).from(stockMovementBatches).where(eq(stockMovementBatches.movementId, m.id));
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: m.itemId, warehouseId: dn.warehouseId, type: "IN",
          quantity: qty, unitCost: cost, date, allocations: smb.map((s) => ({ batchId: s.batchId, quantity: Math.abs(Number(s.quantity)) })), referenceType: "DELIVERY_REVERSE", referenceId: dn.id, reason: `عكس صرف ${dn.number}`,
        });
        cogs += round2(qty * cost);
        const sol = soByItem.get(m.itemId);
        if (sol) await tx.update(salesOrderLines).set({ deliveredQty: sql`GREATEST(0, ${salesOrderLines.deliveredQty} - ${qty})` }).where(eq(salesOrderLines.id, sol.id));
      }
      cogs = round2(cogs);
      if (cogs > 0) {
        await postEntry(tx, {
          orgId: auth.orgId, date, sourceType: "DELIVERY_REVERSE", sourceId: dn.id,
          description: `عكس صرف ${dn.number}`, journalType: "GENERAL", userId: auth.userId,
          lines: [
            { accountId: A["1104"], debit: cogs, credit: 0, description: `عكس صرف مخزون ${dn.number}` },
            { accountId: A["5101"], debit: 0, credit: cogs, description: `عكس ت.ب.م ${dn.number}` },
          ],
        });
      }
      await tx.update(deliveryNotes).set({ status: "REVERSED" }).where(eq(deliveryNotes.id, dn.id));
      if (dn.salesOrderId) await recomputeSalesOrderStatus(tx, dn.salesOrderId);
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "DELIVERY_NOTE", entityId: dn.id, entityNumber: dn.number, summary: `عكس إذن صرف ${dn.number} — أُعيد فتح الأمر`, metadata: { cogs } });
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/orders");
    revalidatePath(`/erp/sales/deliveries/${dn.number}`);
    return { ok: true, id: dn.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر عكس الصرف" };
  }
}
