"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, suppliers, accounts, items, stockMovements,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recompute a purchase order's status from its lines' received/invoiced quantities. */
async function recomputePurchaseOrderStatus(tx: Tx, poId: string) {
  const lines = await tx.select({ q: purchaseOrderLines.quantity, r: purchaseOrderLines.receivedQty, inv: purchaseOrderLines.invoicedQty })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
  const allReceived = lines.every((l) => Number(l.r) >= Number(l.q) - EPS);
  const anyReceived = lines.some((l) => Number(l.r) > EPS);
  const allInvoiced = lines.every((l) => Number(l.inv) >= Number(l.q) - EPS);
  const status = allInvoiced ? "INVOICED" : allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "CONFIRMED";
  await tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, poId));
  return status;
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
 * Receive a confirmed purchase order — fully or PARTIALLY. `picks` caps the
 * accepted quantity per item (≤ remaining = ordered − already received); omitted
 * → receive all remaining. Optional per-line `warehouseId` (defaults to the
 * order warehouse) and `rejectedQty` (recorded only — never enters stock and
 * never advances the order, so it stays open as backorder). `date` is the actual
 * receipt date (defaults to the order date). Stock IN at cost + Dr Inventory /
 * Cr GRNI on the accepted qty, bumps receivedQty, recomputes the order status.
 */
export async function createReceiptFromOrderAction(purchaseOrderId: string, picks?: Pick[], date?: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "CONFIRMED" && po.status !== "PARTIALLY_RECEIVED") return { error: "يمكن الاستلام من أمر مؤكّد أو منفّذ جزئياً فقط" };

  const orderLines = await db.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, unitPrice: purchaseOrderLines.unitPrice, discountAmount: purchaseOrderLines.discountAmount, shippingPerUnit: purchaseOrderLines.shippingPerUnit })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const pickBy = new Map((picks ?? []).map((p) => [p.itemId, p]));
  const toReceive: { line: typeof orderLines[number]; qty: number; rejected: number; warehouseId: string }[] = [];
  for (const l of orderLines) {
    const remaining = round2(Number(l.quantity) - Number(l.receivedQty));
    const p = picks ? pickBy.get(l.itemId) : undefined;
    const want = picks ? (p?.quantity ?? 0) : remaining;
    const rejected = round2(Math.max(0, p?.rejectedQty ?? 0));
    if (want < -EPS) return { error: "كمية غير صالحة" };
    if (want > remaining + EPS) return { error: "الكمية المستلمة أكبر من المتبقّي للصنف" };
    if (want > EPS || rejected > EPS) toReceive.push({ line: l, qty: round2(want), rejected, warehouseId: p?.warehouseId || po.warehouseId });
  }
  if (toReceive.length === 0) return { error: "لا توجد كميات للاستلام" };

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["2103"]) return { error: "حسابات الاستلام غير مكتملة (المخزون/بضاعة لم تُفوتر)." };

  const receiptDate = date ? new Date(date) : new Date(po.date);
  const headerWh = toReceive.find((t) => t.qty > EPS)?.warehouseId || po.warehouseId;
  const number = await nextNumber("GRN", auth.orgId, receiptDate.getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: auth.orgId, number, date: receiptDate, status: "RECEIVED",
        purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: headerWh, notes: `استلام أمر ${po.number}`,
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values(toReceive.map((t) => ({
        purchaseReceiptId: grn.id, itemId: t.line.itemId, warehouseId: t.warehouseId,
        quantity: String(t.qty), rejectedQty: String(t.rejected),
      })));

      let received = 0;
      for (const t of toReceive) {
        if (t.qty <= EPS) continue; // rejected-only line: recorded, no stock/GL
        // Capitalise the per-unit shipping into the inventory cost (plan §10.5).
        const unitNet = Number(t.line.unitPrice) - Number(t.line.discountAmount) / (Number(t.line.quantity) || 1) + Number(t.line.shippingPerUnit);
        const lineNet = round2(t.qty * unitNet);
        received += lineNet;
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: t.line.itemId, warehouseId: t.warehouseId, type: "IN",
          quantity: t.qty, unitCost: unitNet, date: receiptDate,
          referenceType: "GOODS_RECEIPT", referenceId: grn.id, reason: `استلام ${number}`,
        });
        await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${t.qty}` }).where(eq(purchaseOrderLines.id, t.line.id));
      }
      received = round2(received);
      if (received > 0) {
        await postEntry(tx, {
          orgId: auth.orgId, date: receiptDate, sourceType: "GOODS_RECEIPT", sourceId: grn.id,
          description: `استلام بضاعة ${number}`, journalType: "PURCHASE", userId: auth.userId,
          lines: [
            { accountId: A["1104"], debit: received, credit: 0, description: `مخزون مستلم ${number}` },
            { accountId: A["2103"], debit: 0, credit: received, description: `بضاعة لم تُفوتر ${number}` },
          ],
        });
      }
      const newStatus = await recomputePurchaseOrderStatus(tx, po.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "PURCHASE_ORDER", fromId: po.id, fromNumber: po.number, toType: "GOODS_RECEIPT", toId: grn.id, toNumber: number, relation: "FULFILLS" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: number, summary: `استلام ${number} من أمر شراء ${po.number} (${newStatus === "RECEIVED" ? "كامل" : "جزئي"})`, metadata: { received } });
      return grn.id;
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الاستلام" };
  }
}

/** Bill several un-invoiced goods receipts in one go. Skips already-invoiced. */
export async function bulkConvertReceiptsAction(ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  if (!ids.length) return { error: "لم تُحدّد أي إذون" };
  let count = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = await convertReceiptToInvoiceAction(id);
    if (r.ok) count++;
    else lastError = r.error;
  }
  if (count === 0) return { error: lastError ?? "تعذّر التحويل" };
  return { ok: true, count };
}

/**
 * Bill a goods receipt: POSTED purchase invoice for THIS receipt's quantities
 * (clears GRNI → AP; no stock). Amounts pro-rate the order line discount/tax by
 * the received fraction. Bumps invoicedQty + recomputes order status.
 */
export async function convertReceiptToInvoiceAction(receiptId: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  if (grn.purchaseInvoiceId) return { error: "الاستلام مفوتر بالفعل" };
  if (!grn.purchaseOrderId) return { error: "الاستلام غير مرتبط بأمر شراء" };

  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1);
  if (!po) return { error: "أمر الشراء غير موجود" };
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
  const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity })
    .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2103", "1107", "2101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["2103"] || !A["2101"]) return { error: "حسابات الترحيل غير مكتملة" };

  const invLines: { itemId: string; quantity: string; unitPrice: string; discountAmount: string; taxAmount: string; totalAmount: string }[] = [];
  let subtotal = 0, discount = 0, tax = 0;
  for (const gl of grnLines) {
    const po2 = poByItem.get(gl.itemId);
    if (!po2) continue;
    const gq = Number(gl.quantity);
    const oq = Number(po2.quantity) || gq;
    const f = oq > 0 ? gq / oq : 0;
    const price = Number(po2.unitPrice);
    const lineShip = round2(Number(po2.shippingPerUnit) * gq); // capitalised shipping clears GRNI
    const lineDisc = round2(Number(po2.discountAmount) * f);
    const lineTax = round2(Number(po2.taxAmount) * f);
    const lineTotal = round2(price * gq + lineShip - lineDisc + lineTax);
    subtotal += price * gq + lineShip; discount += lineDisc; tax += lineTax;
    invLines.push({ itemId: gl.itemId, quantity: String(gq), unitPrice: String(price), discountAmount: String(lineDisc), taxAmount: String(lineTax), totalAmount: String(lineTotal) });
  }
  subtotal = round2(subtotal); discount = round2(discount); tax = round2(tax);
  const net = round2(subtotal - discount);
  const total = round2(net + tax);
  if (total <= 0) return { error: "لا توجد كميات قابلة للفوترة" };
  const number = await nextNumber("PI", auth.orgId, new Date(po.date).getFullYear());

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: auth.orgId, number, supplierId: po.supplierId, warehouseId: po.warehouseId, goodsReceiptId: grn.id,
        date: new Date(po.date), status: "POSTED", subtotal: String(subtotal), discountAmount: String(discount), taxAmount: String(tax), totalAmount: String(total),
        paidAmount: "0", balanceDue: String(total), notes: `فاتورة استلام ${grn.number}`,
      }).returning({ id: purchaseInvoices.id });
      await tx.insert(purchaseInvoiceLines).values(invLines.map((l) => ({ purchaseInvoiceId: inv.id, ...l })));

      const glLines = [
        { accountId: A["2103"], debit: net, credit: 0, description: `تسوية بضاعة مستلمة ${number}` },
        { accountId: A["2101"], debit: 0, credit: total, description: `مستحق للمورد ${number}` },
      ];
      if (tax > 0 && A["1107"]) glLines.splice(1, 0, { accountId: A["1107"], debit: tax, credit: 0, description: `ضريبة مدخلات ${number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(po.date), sourceType: "PURCHASE_INVOICE", sourceId: inv.id,
        description: `فاتورة شراء ${number} (استلام ${grn.number})`, journalType: "PURCHASE", userId: auth.userId, lines: glLines,
      });
      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${total}` }).where(eq(suppliers.id, po.supplierId));
      await tx.update(purchaseReceipts).set({ purchaseInvoiceId: inv.id, status: "INVOICED" }).where(eq(purchaseReceipts.id, grn.id));
      for (const gl of grnLines) {
        const po2 = poByItem.get(gl.itemId);
        if (po2) await tx.update(purchaseOrderLines).set({ invoicedQty: sql`${purchaseOrderLines.invoicedQty} + ${Number(gl.quantity)}` }).where(eq(purchaseOrderLines.id, po2.id));
      }
      await recomputePurchaseOrderStatus(tx, po.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "GOODS_RECEIPT", fromId: grn.id, fromNumber: grn.number, toType: "PURCHASE_INVOICE", toId: inv.id, toNumber: number, relation: "INVOICES" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: number, summary: `فاتورة شراء ${number} من إذن استلام ${grn.number}`, metadata: { total } });
      return inv.id;
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/purchases/orders");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}
