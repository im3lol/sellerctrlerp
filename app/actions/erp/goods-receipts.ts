"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, accounts, items, stockMovements,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputePurchaseOrderStatus } from "@/lib/erp/purchase-order";

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

export type Pick = { itemId: string; quantity: number; rejectedQty?: number; warehouseId?: string };

export type ReceivableLine = {
  itemId: string; code: string; name: string; ordered: number; received: number; remaining: number;
  stockByWarehouse: Record<string, number>;
};

/**
 * Recall a confirmed/partial purchase order's still-unreceived lines for the
 * goods-receipt form: remaining qty + current on-hand per warehouse per item.
 */
export async function getReceivableOrderLinesAction(purchaseOrderId: string): Promise<
  ActionState & { lines?: ReceivableLine[]; defaultWarehouseId?: string }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };

  const ols = await db
    .select({ itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, code: items.code, name: items.nameAr })
    .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const lines = ols
    .map((l) => {
      const ordered = Number(l.quantity), received = Number(l.receivedQty);
      return { itemId: l.itemId, code: l.code ?? "", name: l.name ?? "", ordered, received, remaining: round2(ordered - received), stockByWarehouse: {} as Record<string, number> };
    })
    .filter((l) => l.remaining > EPS);

  const itemIds = lines.map((l) => l.itemId);
  if (itemIds.length) {
    // Latest running balance per (item, warehouse): newest movement wins.
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

  return { ok: true, lines, defaultWarehouseId: po.warehouseId };
}

/**
 * Save a goods receipt as a DRAFT from a confirmed/partial purchase order — no
 * stock, no GL, the order is NOT advanced (matches the document cycle: save →
 * draft, confirm → post). `picks` set the accepted quantity per item
 * (≤ remaining = ordered − already received); omitted → all remaining. Optional
 * per-line `warehouseId` (defaults to the order warehouse) and `rejectedQty`
 * (recorded only — never enters stock and stays open as backorder). `date` is
 * the receipt date (defaults to the order date). Confirm it later to post.
 */
export async function createReceiptFromOrderAction(purchaseOrderId: string, picks?: Pick[], date?: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "CONFIRMED" && po.status !== "PARTIALLY_RECEIVED") return { error: "يمكن الاستلام من أمر مؤكّد أو منفّذ جزئياً فقط" };

  const orderLines = await db.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const pickBy = new Map((picks ?? []).map((p) => [p.itemId, p]));
  const toReceive: { itemId: string; qty: number; rejected: number; warehouseId: string }[] = [];
  for (const l of orderLines) {
    const remaining = round2(Number(l.quantity) - Number(l.receivedQty));
    const p = picks ? pickBy.get(l.itemId) : undefined;
    const want = picks ? (p?.quantity ?? 0) : remaining;
    const rejected = round2(Math.max(0, p?.rejectedQty ?? 0));
    if (want < -EPS) return { error: "كمية غير صالحة" };
    if (want > remaining + EPS) return { error: "الكمية المستلمة أكبر من المتبقّي للصنف" };
    if (want > EPS || rejected > EPS) toReceive.push({ itemId: l.itemId, qty: round2(want), rejected, warehouseId: p?.warehouseId || po.warehouseId });
  }
  if (toReceive.length === 0) return { error: "لا توجد كميات للاستلام" };

  const receiptDate = date ? new Date(date) : new Date(po.date);
  const headerWh = toReceive.find((t) => t.qty > EPS)?.warehouseId || po.warehouseId;
  const number = await nextNumber("GRN", auth.orgId, receiptDate.getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: auth.orgId, number, date: receiptDate, status: "DRAFT",
        purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: headerWh, notes: `استلام أمر ${po.number}`,
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values(toReceive.map((t) => ({
        purchaseReceiptId: grn.id, itemId: t.itemId, warehouseId: t.warehouseId,
        quantity: String(t.qty), rejectedQty: String(t.rejected),
      })));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: number, summary: `حفظ مسودة إذن استلام ${number} من أمر شراء ${po.number}` });
      return grn.id;
    });
    revalidatePath("/erp/purchases/receipts");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ الاستلام" };
  }
}

/**
 * Confirm a DRAFT goods receipt → POST it: stock IN at cost + Dr 1104 (Inventory)
 * / Cr 2103 (GRNI) on the accepted qty, advance the order's receivedQty (rejected
 * stays backorder), recompute the order status, link + audit, flip DRAFT →
 * RECEIVED. Re-validates accepted ≤ remaining at confirm time. Idempotent.
 */
export async function confirmReceiptAction(receiptId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  if (grn.status !== "DRAFT") return { error: "تم تأكيد إذن الاستلام بالفعل" };
  if (!grn.purchaseOrderId) return { error: "الاستلام غير مرتبط بأمر شراء" };

  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1);
  if (!po) return { error: "أمر الشراء غير موجود" };

  const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, warehouseId: purchaseReceiptLines.warehouseId })
    .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
  const poLines = await db.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, unitPrice: purchaseOrderLines.unitPrice, discountAmount: purchaseOrderLines.discountAmount, shippingPerUnit: purchaseOrderLines.shippingPerUnit })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));

  for (const gl of grnLines) {
    const pol = poByItem.get(gl.itemId);
    if (!pol) return { error: "أحد الأصناف غير موجود في أمر الشراء" };
    const remaining = round2(Number(pol.quantity) - Number(pol.receivedQty));
    if (Number(gl.quantity) > remaining + EPS) return { error: "الكمية المستلمة لأحد الأصناف أكبر من المتبقّي — عدّل المسودة" };
  }

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["2103"]) return { error: "حسابات الاستلام غير مكتملة (المخزون/بضاعة لم تُفوتر)." };

  const receiptDate = new Date(grn.date);
  try {
    await db.transaction(async (tx) => {
      let received = 0;
      for (const gl of grnLines) {
        const qty = Number(gl.quantity);
        if (qty <= EPS) continue; // rejected-only line: recorded, no stock/GL
        const pol = poByItem.get(gl.itemId)!;
        // Capitalise the per-unit shipping into the inventory cost (plan §10.5).
        const unitNet = Number(pol.unitPrice) - Number(pol.discountAmount) / (Number(pol.quantity) || 1) + Number(pol.shippingPerUnit);
        received += round2(qty * unitNet);
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: gl.itemId, warehouseId: gl.warehouseId || grn.warehouseId, type: "IN",
          quantity: qty, unitCost: unitNet, date: receiptDate,
          referenceType: "GOODS_RECEIPT", referenceId: grn.id, reason: `استلام ${grn.number}`,
        });
        await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${qty}` }).where(eq(purchaseOrderLines.id, pol.id));
      }
      received = round2(received);
      if (received > 0) {
        await postEntry(tx, {
          orgId: auth.orgId, date: receiptDate, sourceType: "GOODS_RECEIPT", sourceId: grn.id,
          description: `استلام بضاعة ${grn.number}`, journalType: "PURCHASE", userId: auth.userId,
          lines: [
            { accountId: A["1104"], debit: received, credit: 0, description: `مخزون مستلم ${grn.number}` },
            { accountId: A["2103"], debit: 0, credit: received, description: `بضاعة لم تُفوتر ${grn.number}` },
          ],
        });
      }
      await tx.update(purchaseReceipts).set({ status: "RECEIVED" }).where(eq(purchaseReceipts.id, grn.id));
      const newStatus = await recomputePurchaseOrderStatus(tx, po.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "PURCHASE_ORDER", fromId: po.id, fromNumber: po.number, toType: "GOODS_RECEIPT", toId: grn.id, toNumber: grn.number, relation: "FULFILLS" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: grn.number, summary: `تأكيد إذن استلام ${grn.number} من أمر شراء ${po.number} (${newStatus === "RECEIVED" ? "كامل" : "جزئي"})`, metadata: { received } });
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/orders");
    revalidatePath(`/erp/purchases/receipts/${grn.number}`);
    return { ok: true, id: grn.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر تأكيد الاستلام" };
  }
}

/** Delete a DRAFT goods receipt (nothing posted yet). Confirmed receipts are immutable. */
export async function deleteReceiptAction(receiptId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  if (grn.status !== "DRAFT") return { error: "لا يمكن حذف إذن استلام مؤكّد" };
  try {
    await db.transaction(async (tx) => {
      await tx.delete(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
      await tx.delete(purchaseReceipts).where(eq(purchaseReceipts.id, grn.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: grn.number, summary: `حذف مسودة إذن استلام ${grn.number}` });
    });
    revalidatePath("/erp/purchases/receipts");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
  }
}

/** Bulk confirm / bill / delete goods receipts. Skips rows ineligible for the op. */
export async function bulkReceiptsAction(op: "confirm" | "bill" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "purchases.create" : "purchases.confirm");
  if ("error" in auth) return auth;
  if (!ids.length) return { error: "لم تُحدّد أي إذون" };
  let count = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = op === "confirm" ? await confirmReceiptAction(id)
      : op === "bill" ? await convertReceiptToInvoiceAction(id)
      : await deleteReceiptAction(id);
    if (r.ok) count++;
    else lastError = r.error;
  }
  if (count === 0) return { error: lastError ?? "تعذّر التنفيذ" };
  return { ok: true, count };
}

export type ReceiptInvoiceLine = { itemId: string; code: string; name: string; quantity: number; unitPrice: number; shippingPerUnit: number; discountAmount: number; taxAmount: number; totalAmount: number };
export type ReceiptInvoicePreview = { lines: ReceiptInvoiceLine[]; subtotal: number; shipping: number; discount: number; tax: number; total: number };

/**
 * Compute the invoice a goods receipt would produce: one line per received item,
 * priced from the order (per-unit shipping recalled separately, discount/tax
 * pro-rated by the received fraction). Pure read — used by both the preview and
 * the draft create.
 */
async function buildReceiptInvoice(orgId: string, grn: typeof purchaseReceipts.$inferSelect): Promise<ReceiptInvoicePreview | { error: string }> {
  if (!grn.purchaseOrderId) return { error: "الاستلام غير مرتبط بأمر شراء" };
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1);
  if (!po) return { error: "أمر الشراء غير موجود" };
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
  const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, code: items.code, name: items.nameAr })
    .from(purchaseReceiptLines).leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
    .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));

  const lines: ReceiptInvoiceLine[] = [];
  let subtotal = 0, shipping = 0, discount = 0, tax = 0;
  for (const gl of grnLines) {
    const po2 = poByItem.get(gl.itemId);
    if (!po2) continue;
    const gq = Number(gl.quantity);
    if (gq <= EPS) continue; // rejected-only line: nothing to bill
    const oq = Number(po2.quantity) || gq;
    const f = oq > 0 ? gq / oq : 0;
    const price = Number(po2.unitPrice);
    const shipPerUnit = Number(po2.shippingPerUnit); // recalled from the order, per unit
    const lineShip = round2(shipPerUnit * gq);
    const lineDisc = round2(Number(po2.discountAmount) * f);
    const lineTax = round2(Number(po2.taxAmount) * f);
    const lineTotal = round2(price * gq + lineShip - lineDisc + lineTax);
    subtotal += price * gq; shipping += lineShip; discount += lineDisc; tax += lineTax;
    lines.push({ itemId: gl.itemId, code: gl.code ?? "", name: gl.name ?? "", quantity: gq, unitPrice: price, shippingPerUnit: shipPerUnit, discountAmount: lineDisc, taxAmount: lineTax, totalAmount: lineTotal });
  }
  subtotal = round2(subtotal); shipping = round2(shipping); discount = round2(discount); tax = round2(tax);
  return { lines, subtotal, shipping, discount, tax, total: round2(subtotal + shipping - discount + tax) };
}

/** Preview the invoice a confirmed receipt would produce (for the create form). */
export async function getReceiptInvoicePreviewAction(receiptId: string): Promise<ActionState & { preview?: ReceiptInvoicePreview }> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;
  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  const built = await buildReceiptInvoice(auth.orgId, grn);
  if ("error" in built) return built;
  return { ok: true, preview: built };
}

/**
 * Bill a confirmed goods receipt → a DRAFT purchase invoice for the received
 * quantities (one PI per receipt; lines priced from the order with shipping
 * capitalised and discount/tax pro-rated). No GL until the invoice is posted —
 * posting clears GRNI (2103) → AP (2101). `date`/`notes` are optional overrides.
 */
export async function convertReceiptToInvoiceAction(receiptId: string, date?: string, notes?: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  if (grn.status === "DRAFT") return { error: "أكّد إذن الاستلام أولاً قبل تحويله إلى فاتورة" };
  if (grn.purchaseInvoiceId) return { error: "الاستلام مفوتر بالفعل" };
  const supplierId = grn.supplierId;
  if (!supplierId) return { error: "الاستلام غير مرتبط بمورد" };

  // Prevent a second invoice (draft or posted) for the same receipt.
  const [existing] = await db.select({ id: purchaseInvoices.id }).from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.goodsReceiptId, grn.id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (existing) return { error: "لهذا الإذن فاتورة بالفعل (مسودة أو مرحّلة)" };

  const built = await buildReceiptInvoice(auth.orgId, grn);
  if ("error" in built) return built;
  if (built.total <= 0) return { error: "لا توجد كميات قابلة للفوترة" };

  const invoiceDate = date ? new Date(date) : new Date(grn.date);
  const number = await nextNumber("PI", auth.orgId, invoiceDate.getFullYear());
  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: auth.orgId, number, supplierId, warehouseId: grn.warehouseId, goodsReceiptId: grn.id,
        date: invoiceDate, status: "DRAFT", subtotal: String(built.subtotal), shippingAmount: String(built.shipping),
        discountAmount: String(built.discount), taxAmount: String(built.tax),
        totalAmount: String(built.total), paidAmount: "0", balanceDue: String(built.total), notes: notes || `فاتورة استلام ${grn.number}`,
      }).returning({ id: purchaseInvoices.id });
      await tx.insert(purchaseInvoiceLines).values(built.lines.map((l) => ({
        purchaseInvoiceId: inv.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        shippingPerUnit: String(l.shippingPerUnit), discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: number, summary: `مسودة فاتورة شراء ${number} من إذن استلام ${grn.number}`, metadata: { total: built.total } });
      return inv.id;
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/invoices");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}

/**
 * Fully reverse a confirmed, UN-invoiced goods receipt ("عكس الاستلام"): stock OUT
 * at the original receipt cost + Dr 2103 / Cr 1104, drop the order's receivedQty so
 * it reopens, mark the receipt REVERSED. Invoiced receipts must use the invoice return.
 */
export async function reverseReceiptAction(receiptId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الإذن غير موجود" };
  if (grn.purchaseInvoiceId || grn.status === "INVOICED") return { error: "الإذن مفوتر — استخدم مرتجع الفاتورة" };
  if (grn.status !== "RECEIVED") return { error: "لا يمكن عكس هذا الإذن" };

  const moves = await db.select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));
  if (moves.length === 0) return { error: "لا توجد حركة مخزون للعكس" };

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["2103"]) return { error: "حسابات العكس غير مكتملة" };

  const poLines = grn.purchaseOrderId
    ? await db.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId))
    : [];
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
  const date = new Date();

  try {
    await db.transaction(async (tx) => {
      let value = 0;
      for (const m of moves) {
        const qty = Number(m.quantity), cost = Number(m.unitCost);
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: m.itemId, warehouseId: grn.warehouseId, type: "OUT",
          quantity: qty, unitCost: cost, date, referenceType: "GOODS_RECEIPT_REVERSE", referenceId: grn.id, reason: `عكس استلام ${grn.number}`,
        });
        value += round2(qty * cost);
        const pol = poByItem.get(m.itemId);
        if (pol) await tx.update(purchaseOrderLines).set({ receivedQty: sql`GREATEST(0, ${purchaseOrderLines.receivedQty} - ${qty})` }).where(eq(purchaseOrderLines.id, pol.id));
      }
      value = round2(value);
      if (value > 0) {
        await postEntry(tx, {
          orgId: auth.orgId, date, sourceType: "GOODS_RECEIPT_REVERSE", sourceId: grn.id,
          description: `عكس استلام ${grn.number}`, journalType: "PURCHASE", userId: auth.userId,
          lines: [
            { accountId: A["2103"], debit: value, credit: 0, description: `عكس بضاعة لم تُفوتر ${grn.number}` },
            { accountId: A["1104"], debit: 0, credit: value, description: `عكس مخزون مستلم ${grn.number}` },
          ],
        });
      }
      await tx.update(purchaseReceipts).set({ status: "REVERSED" }).where(eq(purchaseReceipts.id, grn.id));
      if (grn.purchaseOrderId) await recomputePurchaseOrderStatus(tx, grn.purchaseOrderId);
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "REVERSE", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: grn.number, summary: `عكس إذن استلام ${grn.number} — أُعيد فتح الأمر`, metadata: { value } });
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/orders");
    revalidatePath(`/erp/purchases/receipts/${grn.number}`);
    return { ok: true, id: grn.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر عكس الاستلام" };
  }
}
