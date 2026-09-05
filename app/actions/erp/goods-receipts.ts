"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, purchaseReturns, items, stockMovements, stockMovementBatches, stockBatches,
  journalEntries, warehouses, stockSerials, qcInspections} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { inspectedItems, ensureQuarantineWarehouse } from "@/app/actions/erp/quality";
import { getBaseCurrencyCode, resolveCurrency } from "@/lib/erp/currency";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputePurchaseOrderStatus } from "@/lib/erp/purchase-order";
import { goodsReceiptDependents, dependentsList } from "@/lib/erp/doc-dependents";
const EPS = 1e-6;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

export type Pick = { itemId: string; quantity: number; rejectedQty?: number; warehouseId?: string; batchNo?: string | null; expiryDate?: string | null; shippingPerUnit?: number };

export type ReceivableLine = {
  itemId: string; code: string; name: string; image: string | null; ordered: number; received: number; remaining: number;
  stockByWarehouse: Record<string, number>;
  isPerishable: boolean; shelfLifeDays: number | null;
  // For this delivery's OWN landed-cost distribution (value/qty/weight) — see the
  // memory on per-receipt landed cost. unitPrice/weightKg are read-only inputs to
  // that math, not what's billed (billing still prices from the PO line).
  unitPrice: number; weightKg: number;
  poShippingPerUnit: number; // the PO's own rate — this line's default until overridden
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

  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };

    const ols = await db
      .select({ itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, unitPrice: purchaseOrderLines.unitPrice, shippingPerUnit: purchaseOrderLines.shippingPerUnit, code: items.code, name: items.nameAr, image: items.image, isPerishable: items.isPerishable, shelfLifeDays: items.shelfLifeDays, weightKg: items.weightKg })
      .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
      .where(eq(purchaseOrderLines.purchaseOrderId, po.id));

    const lines = ols
      .map((l) => {
        const ordered = Number(l.quantity), received = Number(l.receivedQty);
        return {
          itemId: l.itemId, code: l.code ?? "", name: l.name ?? "", image: l.image ?? null, ordered, received, remaining: round2(ordered - received), stockByWarehouse: {} as Record<string, number>, isPerishable: Boolean(l.isPerishable), shelfLifeDays: l.shelfLifeDays ?? null,
          unitPrice: Number(l.unitPrice), weightKg: l.weightKg != null ? Number(l.weightKg) : 0, poShippingPerUnit: Number(l.shippingPerUnit),
        };
      })
      .filter((l) => l.remaining > EPS);

    const itemIds = lines.map((l) => l.itemId);
    if (itemIds.length) {
      // Latest running balance per (item, warehouse): newest movement wins.
      const sm = await db
        .select({ itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, bal: stockMovements.balanceQuantity })
        .from(stockMovements)
        .where(and(eq(stockMovements.organizationId, auth.orgId), inArray(stockMovements.itemId, itemIds)))
        .orderBy(desc(stockMovements.createdAt), desc(sql`split_part(${stockMovements.number}, '-', 3)::int`));
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
  });
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
export async function createReceiptFromOrderAction(purchaseOrderId: string, picks?: Pick[], date?: string): Promise<ActionState & { id?: string; number?: string }> {
  const auth = await authorizeErp("purchases.receive");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [po] = await db.select().from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "الأمر غير موجود" };
    if (po.status !== "CONFIRMED" && po.status !== "PARTIALLY_RECEIVED") return { error: "يمكن الاستلام من أمر مؤكّد أو منفّذ جزئياً فقط" };

    const orderLines = await db.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, shippingPerUnit: purchaseOrderLines.shippingPerUnit, isPerishable: items.isPerishable, shelfLifeDays: items.shelfLifeDays, code: items.code, name: items.nameAr })
      .from(purchaseOrderLines).innerJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.purchaseOrderId, po.id));

    // Per-line pick warehouses flow into stock movements — verify they belong to the org.
    const pickWhIds = [...new Set((picks ?? []).map((p) => p.warehouseId).filter((w): w is string => !!w))];
    if (pickWhIds.length) {
      const okWh = await db.select({ id: warehouses.id }).from(warehouses)
        .where(and(inArray(warehouses.id, pickWhIds), eq(warehouses.organizationId, auth.orgId)));
      if (okWh.length !== pickWhIds.length) return { error: "مستودع غير صالح في أحد البنود" };
    }
    const pickBy = new Map((picks ?? []).map((p) => [p.itemId, p]));
    const toReceive: { itemId: string; qty: number; rejected: number; warehouseId: string; batchNo: string | null; expiryDate: Date | null; shippingPerUnit: number }[] = [];
    for (const l of orderLines) {
      const remaining = round2(Number(l.quantity) - Number(l.receivedQty));
      const p = picks ? pickBy.get(l.itemId) : undefined;
      const want = picks ? (p?.quantity ?? 0) : remaining;
      const rejected = round2(Math.max(0, p?.rejectedQty ?? 0));
      if (want < -EPS) return { error: "كمية غير صالحة" };
      if (want > remaining + EPS) return { error: "الكمية المستلمة أكبر من المتبقّي للصنف" };
      // Enforce expiry capture for perishables at the source (data-entry time): a
      // perishable item must arrive with an expiry date, or an item shelf-life to derive
      // one — otherwise its stock lands in the untracked NULL-expiry lot and FEFO/alerts
      // can't see it. (Safe: recoverable — enter the expiry and retry.)
      if (want > EPS && l.isPerishable && !(p?.expiryDate) && !(l.shelfLifeDays && l.shelfLifeDays > 0)) {
        return { error: `الصنف «${l.name || l.code}» قابل للتلف — حدِّد تاريخ صلاحية للاستلام (أو اضبط «مدة الصلاحية» للصنف).` };
      }
      if (want > EPS || rejected > EPS) toReceive.push({ itemId: l.itemId, qty: round2(want), rejected, warehouseId: p?.warehouseId || po.warehouseId, batchNo: p?.batchNo?.trim() || null, expiryDate: p?.expiryDate ? new Date(p.expiryDate) : null, shippingPerUnit: p?.shippingPerUnit ?? Number(l.shippingPerUnit) });
    }
    if (toReceive.length === 0) return { error: "لا توجد كميات للاستلام" };

    const receiptDate = date ? new Date(date) : new Date(po.date);
    const headerWh = toReceive.find((t) => t.qty > EPS)?.warehouseId || po.warehouseId;
    const number = await nextNumber("GRN", auth.orgId, receiptDate.getFullYear());
    try {
      const created = await db.transaction(async (tx) => {
        const [grn] = await tx.insert(purchaseReceipts).values({
          organizationId: auth.orgId, number, date: receiptDate, status: "DRAFT",
          purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: headerWh, notes: `استلام أمر ${po.number}`,
          // The order's rate is THE approved rate for this cycle. Stamping it on the
          // receipt is not a second opinion — it is the same number, carried so the
          // document says out loud what it was valued at instead of making a reader open
          // the order to find out.
          currencyCode: po.currencyCode, exchangeRate: po.exchangeRate,
          foreignAmount: null, rateSource: po.rateSource,
        }).returning({ id: purchaseReceipts.id });
        await tx.insert(purchaseReceiptLines).values(toReceive.map((t) => ({
          purchaseReceiptId: grn.id, itemId: t.itemId, warehouseId: t.warehouseId,
          quantity: String(t.qty), rejectedQty: String(t.rejected), batchNo: t.batchNo, expiryDate: t.expiryDate, shippingPerUnit: String(t.shippingPerUnit),
        })));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: number, summary: `حفظ مسودة إذن استلام ${number} من أمر شراء ${po.number}` });
        return { id: grn.id, number };
      });
      revalidatePath("/purchases/receipts");
      return { ok: true, id: created.id, number: created.number };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ الاستلام" };
    }
  });
}

/**
 * Confirm a DRAFT goods receipt → POST it: stock IN at cost + Dr 1104 (Inventory)
 * / Cr 2103 (GRNI) on the accepted qty, advance the order's receivedQty (rejected
 * stays backorder), recompute the order status, link + audit, flip DRAFT →
 * RECEIVED. Re-validates accepted ≤ remaining at confirm time. Idempotent.
 */
/**
 * Verify every serial-tracked line on a receipt carries a serial per unit. Returns an
 * Arabic error naming the item, or null when the receipt is consistent.
 */
async function serialCountsMatch(
  orgId: string,
  receiptId: string,
  lines: { itemId: string; quantity: string | number }[],
): Promise<string | null> {
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  if (!itemIds.length) return null;

  const tracked = await db.select({ id: items.id, code: items.code, tracking: items.tracking })
    .from(items).where(and(eq(items.organizationId, orgId), inArray(items.id, itemIds)));
  const serialItems = tracked.filter((i) => i.tracking === "SERIAL");
  if (!serialItems.length) return null;

  const counts = await db
    .select({ itemId: stockSerials.itemId, n: sql<string>`count(*)` })
    .from(stockSerials)
    .where(and(eq(stockSerials.organizationId, orgId), eq(stockSerials.receiptId, receiptId)))
    .groupBy(stockSerials.itemId);
  const byItem = new Map(counts.map((c) => [c.itemId, Number(c.n)]));

  for (const item of serialItems) {
    const want = lines.filter((l) => l.itemId === item.id).reduce((s, l) => s + Number(l.quantity), 0);
    if (want <= EPS) continue; // rejected-only line books no stock, so it needs no serials
    const got = byItem.get(item.id) ?? 0;
    if (got !== Math.round(want)) {
      return `${item.code}: سجّل ${Math.round(want)} رقم تسلسلي (المسجّل حالياً ${got}) قبل تأكيد الاستلام`;
    }
  }
  return null;
}

export async function confirmReceiptAction(receiptId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.receive");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الاستلام غير موجود" };
    if (grn.status !== "DRAFT") return { error: "تم تأكيد إذن الاستلام بالفعل" };
    if (!grn.purchaseOrderId) return { error: "الاستلام غير مرتبط بأمر شراء" };

    const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, grn.purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return { error: "أمر الشراء غير موجود" };
    // Re-read the order's status at confirm time rather than trusting it from when
    // the draft was saved: cancelling an order leaves its drafts untouched, so
    // without this a stale draft still receives stock against a cancelled order —
    // and recomputePurchaseOrderStatus below would then flip it back to RECEIVED.
    if (po.status === "CANCELLED") return { error: "أمر الشراء ملغي — لا يمكن تأكيد الاستلام" };
    if (po.status === "DRAFT") return { error: "أمر الشراء لم يُؤكَّد بعد" };
    // The order was converted straight to an invoice (standalone branch posts the
    // stock itself) — confirming a stale GRN draft on top would receive the goods a
    // second time (doubled inventory + a GRNI credit nothing will ever clear).
    if (po.status === "INVOICED") return { error: "أمر الشراء مفوتر مباشرة — المخزون مستلم عبر الفاتورة، احذف مسودة الاستلام" };

    const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, warehouseId: purchaseReceiptLines.warehouseId, batchNo: purchaseReceiptLines.batchNo, expiryDate: purchaseReceiptLines.expiryDate, shippingPerUnit: purchaseReceiptLines.shippingPerUnit })
      .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
    const A = await resolveAccountIds(auth.orgId, ["1104", "2103"]);
    if (!A["1104"] || !A["2103"]) return { error: "حسابات الاستلام غير مكتملة (المخزون/بضاعة لم تُفوتر)." };

    // Serial-tracked lines must hand over exactly as many serials as they book. This is
    // the one invariant holding the serial ledger and the stock ledger together — let it
    // slip and the two disagree silently, which is worse than refusing the confirmation.
    const serialCheck = await serialCountsMatch(auth.orgId, grn.id, grnLines);
    if (serialCheck) return { error: serialCheck };

    const receiptDate = new Date(grn.date);

    // Items under inspection are received into quarantine instead of the destination:
    // on the books at cost, in the valuation, and unsellable because nobody sells from
    // quarantine. A pass releases them with an ordinary transfer.
    const needsQc = await inspectedItems(auth.orgId, grnLines.map((l) => l.itemId));
    const quarantineId = needsQc.size ? await ensureQuarantineWarehouse(auth.orgId) : null;

    try {
      await db.transaction(async (tx) => {
        // Re-check the receipt status UNDER LOCK — the outside check races a
        // double-click, and a zero-value receipt posts no GL entry, so the
        // postEntry unique index can't catch the duplicate stock IN.
        const [lockedGrn] = await tx.select({ status: purchaseReceipts.status }).from(purchaseReceipts)
          .where(eq(purchaseReceipts.id, grn.id)).for("update").limit(1);
        if (lockedGrn?.status !== "DRAFT") throw new Error("تم تأكيد إذن الاستلام بالفعل");
        // Lock the PO lines FOR UPDATE and re-validate "≤ remaining" inside the tx so
        // two concurrent partial receipts can't both pass on a stale receivedQty and
        // over-receive the order (doubled inventory + GRNI).
        const poLines = await tx.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, receivedQty: purchaseOrderLines.receivedQty, unitPrice: purchaseOrderLines.unitPrice, discountAmount: purchaseOrderLines.discountAmount, shippingPerUnit: purchaseOrderLines.shippingPerUnit })
          .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id)).for("update");
        const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
        // Validate AGGREGATED per item — duplicate lines for the same item (on
        // either document) would each pass an individual ≤-remaining check while
        // their sum over-receives the order (doubled inventory + GRNI).
        const orderedByItem = new Map<string, number>(), receivedByItem = new Map<string, number>(), wantByItem = new Map<string, number>();
        for (const l of poLines) {
          orderedByItem.set(l.itemId, (orderedByItem.get(l.itemId) ?? 0) + Number(l.quantity));
          receivedByItem.set(l.itemId, (receivedByItem.get(l.itemId) ?? 0) + Number(l.receivedQty));
        }
        for (const gl of grnLines) wantByItem.set(gl.itemId, (wantByItem.get(gl.itemId) ?? 0) + Number(gl.quantity));
        for (const [itemId, want] of wantByItem) {
          if (!poByItem.has(itemId)) throw new Error("أحد الأصناف غير موجود في أمر الشراء");
          const remaining = round2((orderedByItem.get(itemId) ?? 0) - (receivedByItem.get(itemId) ?? 0));
          if (want > remaining + EPS) throw new Error("الكمية المستلمة لأحد الأصناف أكبر من المتبقّي — عدّل المسودة");
        }
        let received = 0;
        for (const gl of grnLines) {
          const qty = Number(gl.quantity);
          if (qty <= EPS) continue; // rejected-only line: recorded, no stock/GL
          const pol = poByItem.get(gl.itemId)!;
          // Capitalise the per-unit shipping into the inventory cost. Price/discount
          // still come from the PO line, but shipping is THIS receipt's own real
          // freight cost — each delivery batch can carry a different rate.
          //
          const unitNet = Number(pol.unitPrice) - Number(pol.discountAmount) / (Number(pol.quantity) || 1) + Number(gl.shippingPerUnit);
          received += round2(qty * unitNet);
          const destinationId = gl.warehouseId || grn.warehouseId;
          const holdForQc = needsQc.has(gl.itemId) && quarantineId;
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: gl.itemId, warehouseId: holdForQc ? quarantineId : destinationId, type: "IN",
            quantity: qty, unitCost: unitNet, date: receiptDate,
            batchNo: gl.batchNo ?? null, expiryDate: gl.expiryDate ? new Date(gl.expiryDate) : null, deriveExpiryFromShelfLife: true,
            referenceType: "GOODS_RECEIPT", referenceId: grn.id, reason: `استلام ${grn.number}`,
          });
          await tx.update(purchaseOrderLines).set({ receivedQty: sql`${purchaseOrderLines.receivedQty} + ${qty}` }).where(eq(purchaseOrderLines.id, pol.id));

          if (holdForQc) {
            const qcNumber = await nextDocumentNumber(tx, auth.orgId, "QC", receiptDate.getFullYear());
            await tx.insert(qcInspections).values({
              organizationId: auth.orgId, number: qcNumber,
              receiptId: grn.id, receiptNumber: grn.number,
              itemId: gl.itemId,
              quarantineWarehouseId: quarantineId,
              targetWarehouseId: destinationId,
              quantity: String(qty), status: "PENDING",
            });
          }
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
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/orders");
      revalidatePath(`/purchases/receipts/${grn.number}`);
      return { ok: true, id: grn.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر تأكيد الاستلام" };
    }
  });
}

/** Delete a DRAFT goods receipt (nothing posted yet). Confirmed receipts are immutable. */
export async function deleteReceiptAction(receiptId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.receive");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
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
      revalidatePath("/purchases/receipts");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
    }
  });
}

/**
 * Cancel a RECEIVED goods receipt — the "I entered this by mistake" path, as opposed
 * to مرتجع (goods physically going back to the supplier). Reverses its GL entry, takes
 * the stock back OUT of the exact batches it came into, rolls back the order's
 * receivedQty, and marks it CANCELLED. The document is KEPT (never hard-deleted) so the
 * posting/reversal pair stays auditable — mirrors reversePurchaseReturnAction.
 */
export async function cancelReceiptAction(receiptId: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الاستلام غير موجود" };
    if (grn.status === "DRAFT") return { error: "المسودة تُحذف مباشرة — لا تحتاج إلغاء" };
    if (grn.status !== "RECEIVED") return { error: "يمكن إلغاء إذن استلام مؤكّد فقط" };

    // Name what's blocking instead of a vague refusal: the invoice it was billed on, its
    // returns, a landed-cost voucher that costed it, or whatever consumed the stock.
    const deps = await goodsReceiptDependents(auth.orgId, grn.id);
    if (deps.length) {
      return { error: `لا يمكن إلغاء الاستلام — البضاعة مرتبطة بمستندات أخرى: ${dependentsList(deps)}. ألغِ/عالِج هذه المستندات أولاً، أو استخدم «مرتجع» إذا كانت البضاعة رجعت للمورد.` };
    }

    const d = new Date();
    try {
      await db.transaction(async (tx) => {
        // Re-read under lock: a concurrent bill/cancel would otherwise double-reverse.
        const [locked] = await tx.select({ status: purchaseReceipts.status, invId: purchaseReceipts.purchaseInvoiceId })
          .from(purchaseReceipts).where(eq(purchaseReceipts.id, grn.id)).for("update").limit(1);
        if (locked?.status !== "RECEIVED") throw new Error("تم إلغاء إذن الاستلام بالفعل");
        if (locked.invId) throw new Error("الاستلام مفوتر — احذف/ألغِ الفاتورة أولاً ثم ألغِ الاستلام");

        const moves = await tx.select({ id: stockMovements.id, itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost, type: stockMovements.type, warehouseId: stockMovements.warehouseId })
          .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));

        // The received goods must still be on hand in the same lots: once they're sold or
        // moved the cost is already in COGS, and pulling them back out here would post a
        // negative lot. That case is a real مرتجع, not a data-entry cancel.
        for (const m of moves) {
          const smb = await tx.select({ batchId: stockMovementBatches.batchId, quantity: stockMovementBatches.quantity })
            .from(stockMovementBatches).where(eq(stockMovementBatches.movementId, m.id));
          for (const s of smb) {
            const [b] = await tx.select({ rem: stockBatches.remainingQuantity }).from(stockBatches).where(eq(stockBatches.id, s.batchId)).limit(1);
            if (!b || Number(b.rem) + EPS < Math.abs(Number(s.quantity))) {
              throw new Error("تم صرف/بيع جزء من البضاعة المستلمة — استخدم «مرتجع» بدلاً من الإلغاء");
            }
          }
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId, type: "OUT",
            quantity: Number(m.quantity), unitCost: Number(m.unitCost), date: d,
            allocations: smb.map((s) => ({ batchId: s.batchId, quantity: Math.abs(Number(s.quantity)) })),
            referenceType: "GOODS_RECEIPT_REVERSE", referenceId: grn.id, reason: `إلغاء إذن استلام ${grn.number}`,
          });
        }

        const entries = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "GOODS_RECEIPT"), eq(journalEntries.sourceId, grn.id), eq(journalEntries.status, "POSTED")));
        for (const e of entries) await reverseEntry(tx, { orgId: auth.orgId, entryId: e.id, date: d, userId: auth.userId, reason: `إلغاء إذن استلام ${grn.number}` });

        // Give the quantities back to the order so the remaining balance reopens.
        if (grn.purchaseOrderId) {
          const gLines = await tx.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity })
            .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
          const poLines = await tx.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId })
            .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));
          const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
          for (const l of gLines) {
            const pol = poByItem.get(l.itemId);
            if (pol) await tx.update(purchaseOrderLines).set({ receivedQty: sql`GREATEST(0, ${purchaseOrderLines.receivedQty} - ${Number(l.quantity)})` }).where(eq(purchaseOrderLines.id, pol.id));
          }
          await recomputePurchaseOrderStatus(tx, grn.purchaseOrderId);
        }

        await tx.update(purchaseReceipts).set({ status: "CANCELLED" }).where(eq(purchaseReceipts.id, grn.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "GOODS_RECEIPT", entityId: grn.id, entityNumber: grn.number, summary: `إلغاء إذن استلام ${grn.number} وعكس أثره على المخزون والحسابات` });
      });
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/orders");
      revalidatePath(`/purchases/receipts/${grn.number}`);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إلغاء الاستلام" };
    }
  });
}

/** Bulk confirm / bill / delete goods receipts. Skips rows ineligible for the op. */
export async function bulkReceiptsAction(op: "confirm" | "bill" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "bill" ? "purchases.create" : "purchases.receive");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
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
  });
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
  const [po] = await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, grn.purchaseOrderId), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!po) return { error: "أمر الشراء غير موجود" };
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
  const grnLines = await db.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, shippingPerUnit: purchaseReceiptLines.shippingPerUnit, code: items.code, name: items.nameAr })
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
    const shipPerUnit = Number(gl.shippingPerUnit); // this receipt's own rate, not the PO's estimate
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
  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الاستلام غير موجود" };
    const built = await buildReceiptInvoice(auth.orgId, grn);
    if ("error" in built) return built;
    return { ok: true, preview: built };
  });
}

/**
 * Bill a confirmed goods receipt → a DRAFT purchase invoice for the received
 * quantities (one PI per receipt; lines priced from the order with shipping
 * capitalised and discount/tax pro-rated). No GL until the invoice is posted —
 * posting clears GRNI (2103) → AP (2101). `date`/`notes` are optional overrides.
 */
export async function convertReceiptToInvoiceAction(
  receiptId: string,
  date?: string,
  notes?: string,
  currencyCode?: string,
  exchangeRate?: number,
): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الاستلام غير موجود" };
    if (grn.status === "DRAFT") return { error: "أكّد إذن الاستلام أولاً قبل تحويله إلى فاتورة" };
    if (grn.status === "CANCELLED") return { error: "إذن الاستلام ملغي — لا يمكن فوترته" };
    if (grn.purchaseInvoiceId) return { error: "الاستلام مفوتر بالفعل" };
    const supplierId = grn.supplierId;
    if (!supplierId) return { error: "الاستلام غير مرتبط بمورد" };

    // Prevent a second invoice (draft or posted) for the same receipt.
    const [existing] = await db.select({ id: purchaseInvoices.id }).from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.goodsReceiptId, grn.id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (existing) return { error: "لهذا الإذن فاتورة بالفعل (مسودة أو مرحّلة)" };

    const invoiceDate = date ? new Date(date) : new Date(grn.date);

    // ONE approved rate for the whole cycle. The order's rate — whatever the buyer chose
    // or typed there — is what the receipt and this invoice carry, so the same shipment is
    // never valued two ways and GRNI clears to the piastre. A caller may still pass a
    // currency/rate for a receipt raised outside an order.
    const baseCode = await getBaseCurrencyCode(auth.orgId);
    const code = (grn.currencyCode ?? currencyCode ?? baseCode).toUpperCase();
    const approvedRate = Number(grn.exchangeRate ?? 0) > 0
      ? Number(grn.exchangeRate)
      : (exchangeRate && exchangeRate > 0 ? exchangeRate : 1);

    const built = await buildReceiptInvoice(auth.orgId, grn);
    if ("error" in built) return built;
    if (built.total <= 0) return { error: "لا توجد كميات قابلة للفوترة" };

    const cur = resolveCurrency(baseCode, code, approvedRate, built.total);
    const rateSource = grn.rateSource ?? "AUTO";
    const number = await nextNumber("PI", auth.orgId, invoiceDate.getFullYear());
    try {
      const invoiceId = await db.transaction(async (tx) => {
        const [inv] = await tx.insert(purchaseInvoices).values({
          organizationId: auth.orgId, number, supplierId, warehouseId: grn.warehouseId, goodsReceiptId: grn.id,
          date: invoiceDate, status: "DRAFT", subtotal: String(built.subtotal), shippingAmount: String(built.shipping),
          discountAmount: String(built.discount), taxAmount: String(built.tax),
          totalAmount: String(built.total), paidAmount: "0", balanceDue: String(built.total), notes: notes || `فاتورة استلام ${grn.number}`,
          currencyCode: cur.code, exchangeRate: String(cur.rate),
          foreignAmount: cur.foreignAmount !== null ? String(cur.foreignAmount) : null,
          rateSource,
        }).returning({ id: purchaseInvoices.id });
        await tx.insert(purchaseInvoiceLines).values(built.lines.map((l) => ({
          purchaseInvoiceId: inv.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
          shippingPerUnit: String(l.shippingPerUnit), discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
        })));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: number, summary: `مسودة فاتورة شراء ${number} من إذن استلام ${grn.number}`, metadata: { total: built.total } });
        return inv.id;
      });
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/invoices");
      return { ok: true, invoiceId };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
    }
  });
}

/**
 * Fully reverse a confirmed, UN-invoiced goods receipt ("عكس الاستلام"): stock OUT
 * at the original receipt cost + Dr 2103 / Cr 1104, drop the order's receivedQty so
 * it reopens, mark the receipt REVERSED. Invoiced receipts must use the invoice return.
 */
export async function reverseReceiptAction(receiptId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [grn] = await db.select().from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
    if (!grn) return { error: "الإذن غير موجود" };
    // An INVOICED receipt already cleared GRNI (2103) into AP — reversing here would
    // debit 2103 a second time and leave the posted invoice fully payable for goods
    // that "never arrived". Use the return flow (مرتجع الإذن + مرتجع الفاتورة) instead.
    if (grn.status !== "RECEIVED") return { error: grn.status === "INVOICED" ? "الإذن مفوتر — استخدم مرتجع الإذن ومرتجع الفاتورة بدل العكس" : "لا يمكن عكس هذا الإذن" };
    // A posted return already took part of this stock back out — a full reversal on
    // top would issue those units a second time. Cancel the returns first.
    const [priorRet] = await db.select({ id: purchaseReturns.id }).from(purchaseReturns)
      .where(and(eq(purchaseReturns.purchaseReceiptId, grn.id), eq(purchaseReturns.status, "POSTED"))).limit(1);
    if (priorRet) return { error: "توجد مرتجعات مرحّلة على هذا الإذن — ألغِ المرتجعات أولاً" };

    const moves = await db.select({ id: stockMovements.id, itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
      .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));
    if (moves.length === 0) return { error: "لا توجد حركة مخزون للعكس" };

    const A = await resolveAccountIds(auth.orgId, ["1104", "2103"]);
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
          const smb = await tx.select({ batchId: stockMovementBatches.batchId, quantity: stockMovementBatches.quantity }).from(stockMovementBatches).where(eq(stockMovementBatches.movementId, m.id));
          // GL from the ledger's actual re-posted value, not the stored original
          // cost (else GL drifts from the ledger when the pinned lot re-averaged).
          const r = await postStockMovement(tx, {
            // Issue from the warehouse the IN actually landed in (per-line picks may
            // differ from the header warehouse) — else ledger and batches diverge.
            orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId, type: "OUT",
            quantity: qty, unitCost: cost, date, allocations: smb.map((s) => ({ batchId: s.batchId, quantity: Math.abs(Number(s.quantity)) })), referenceType: "GOODS_RECEIPT_REVERSE", referenceId: grn.id, reason: `عكس استلام ${grn.number}`,
          });
          value += r.totalCost;
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
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/orders");
      revalidatePath(`/purchases/receipts/${grn.number}`);
      return { ok: true, id: grn.id };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر عكس الاستلام" };
    }
  });
}
