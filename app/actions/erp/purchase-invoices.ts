"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { round2 } from "@/lib/erp/money";
import { applyCostAdjustment } from "@/lib/erp/cost-adjust";
import { receiptLineCosts } from "@/lib/erp/receipt-cost";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines, journalEntries, stockMovements } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { purchaseInvoiceDependents, dependentsList } from "@/lib/erp/doc-dependents";
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputePurchaseOrderStatus } from "@/lib/erp/purchase-order";

export type SaveInvoiceState = ActionState & { id?: string };


/*
 * There is no createPurchaseInvoiceAction any more: a purchase invoice is only ever
 * raised from a confirmed goods receipt by convertReceiptToInvoiceAction
 * (app/actions/erp/goods-receipts.ts), which is the only writer of goodsReceiptId.
 * The old standalone creator let the invoice post stock itself — a second costing
 * path for the same goods, and nothing for landed costs to attach to.
 */

/**
 * Post a DRAFT purchase invoice. There is ONE path: the invoice must come from a
 * confirmed goods receipt. The goods are already in stock (the GRN did Dr 1104 /
 * Cr 2103), so posting only clears GRNI →
 *   Dr بضاعة لم تُفوتر (2103) = الصافي
 *   Dr ضريبة المدخلات (1107) = الضريبة
 *   Cr الموردون (2101) = الإجمالي
 * No stock movement; marks the receipt INVOICED, bumps the order's invoicedQty.
 *
 * The old standalone branch (invoice receives stock itself) was removed: it was a
 * second costing path for the same goods and left landed costs nothing to attach to.
 */
export async function postPurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

    if (!inv.goodsReceiptId) {
      return { error: "فاتورة الشراء لازم تكون من إذن استلام مؤكّد — الدورة: أمر شراء ← إذن استلام ← فاتورة" };
    }

    const total = Number(inv.totalAmount);
    const tax = Number(inv.taxAmount);
    const net = Number(inv.subtotal) + Number(inv.shippingAmount) - Number(inv.discountAmount);

    const byCode = await resolveAccountIds(auth.orgId, ["2103", "1107", "2101", "1104", "5101"]);
    const debitAcc = byCode["2103"];
    if (!debitAcc || !byCode["2101"]) return { error: "حسابات الترحيل غير مكتملة." };

    try {
      await db.transaction(async (tx) => {
        // Goods were already received by the GRN — just settle GRNI and advance the order.
        const [grn] = await tx.select().from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId!)).limit(1);
        if (!grn) throw new Error("إذن الاستلام غير موجود");

        // ── Three-way match ──────────────────────────────────────────────────────
        // The GRNI leg is FIXED at whatever the receipt capitalised; the supplier's
        // actual invoice may differ. That gap is a cost correction on the very same
        // goods, so it goes where landed costs go: the on-hand share revalues stock,
        // the already-sold share hits COGS.
        const varianceLines = await receiptLineCosts(tx, grn);
        const grniAmount = round2(varianceLines.reduce((s, l) => s + l.value, 0));
        const variance = round2(net - grniAmount);

        const glLines = [
          { accountId: debitAcc, debit: grniAmount, credit: 0, description: `تسوية بضاعة مستلمة ${inv.number}` },
          { accountId: byCode["2101"], debit: 0, credit: total, description: `مستحق للمورد ${inv.number}` },
        ];
        if (tax > 0 && byCode["1107"]) glLines.splice(1, 0, { accountId: byCode["1107"], debit: tax, credit: 0, description: `ضريبة مدخلات ${inv.number}` });

        if (Math.abs(variance) > 0.004) {
          if (!byCode["1104"] || !byCode["5101"]) throw new Error("حسابات فرق السعر غير مكتملة (المخزون/تكلفة المبيعات).");
          const totalQty = varianceLines.reduce((s, l) => s + l.quantity, 0);
          if (totalQty <= 0) throw new Error("لا توجد كميات لتوزيع فرق السعر عليها");
          const { toInventory, toCogs } = await applyCostAdjustment(tx, {
            orgId: auth.orgId, refType: "PURCHASE_INVOICE_VARIANCE", refId: inv.id,
            date: new Date(inv.date), reason: `فرق سعر فاتورة ${inv.number}`,
            // Spread the gap over the billed lines in proportion to quantity. The LAST
            // line absorbs the rounding remainder so the shares sum to `variance`
            // exactly — otherwise the entry is off by a piaster and the DB's
            // balanced-entry trigger rejects the whole posting.
            lines: varianceLines.map((l, i) => {
              const share = i === varianceLines.length - 1
                ? round2(variance - varianceLines.slice(0, i).reduce((s, x) => s + round2(variance * (x.quantity / totalQty)), 0))
                : round2(variance * (l.quantity / totalQty));
              return { itemId: l.itemId, warehouseId: l.warehouseId, quantity: l.quantity, perUnit: share / l.quantity, amount: share };
            }),
          });
          if (Math.abs(toInventory) > 0.004) glLines.push({ accountId: byCode["1104"], debit: Math.max(0, toInventory), credit: Math.max(0, -toInventory), description: `فرق سعر على المخزون ${inv.number}` });
          if (Math.abs(toCogs) > 0.004) glLines.push({ accountId: byCode["5101"], debit: Math.max(0, toCogs), credit: Math.max(0, -toCogs), description: `فرق سعر على بضاعة مُباعة ${inv.number}` });
        }

        await postEntry(tx, {
          orgId: auth.orgId, date: new Date(inv.date), sourceType: "PURCHASE_INVOICE", sourceId: inv.id,
          description: `فاتورة شراء ${inv.number}`, journalType: "PURCHASE", userId: auth.userId, lines: glLines,
        });

        await tx.update(purchaseReceipts).set({ purchaseInvoiceId: inv.id, status: "INVOICED" }).where(eq(purchaseReceipts.id, inv.goodsReceiptId!));
        if (grn?.purchaseOrderId) {
          const grnLines = await tx.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity })
            .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
          // Lock the order lines and check the billed quantity can't outrun what was
          // actually received — one-invoice-per-receipt made this safe only indirectly.
          const poLines = await tx.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId, receivedQty: purchaseOrderLines.receivedQty, invoicedQty: purchaseOrderLines.invoicedQty })
            .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId)).for("update");
          const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
          const billing = new Map<string, number>();
          for (const gl of grnLines) billing.set(gl.itemId, (billing.get(gl.itemId) ?? 0) + Number(gl.quantity));
          for (const [itemId, qty] of billing) {
            const pol = poByItem.get(itemId);
            if (!pol) continue;
            if (Number(pol.invoicedQty) + qty > Number(pol.receivedQty) + 1e-6) {
              throw new Error("الكمية المفوترة لأحد الأصناف أكبر من المستلم — راجِع إذون الاستلام");
            }
          }
          for (const gl of grnLines) {
            const pol = poByItem.get(gl.itemId);
            if (pol) await tx.update(purchaseOrderLines).set({ invoicedQty: sql`${purchaseOrderLines.invoicedQty} + ${Number(gl.quantity)}` }).where(eq(purchaseOrderLines.id, pol.id));
          }
          await recomputePurchaseOrderStatus(tx, grn.purchaseOrderId);
          await linkDocuments(tx, { orgId: auth.orgId, fromType: "GOODS_RECEIPT", fromId: grn.id, fromNumber: grn.number, toType: "PURCHASE_INVOICE", toId: inv.id, toNumber: inv.number, relation: "INVOICES" });
        }

        // Establish the supplier payable now (not at draft).
        await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${total}` }).where(eq(suppliers.id, inv.supplierId));
        await tx.update(purchaseInvoices).set({ status: "POSTED" }).where(eq(purchaseInvoices.id, inv.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `ترحيل فاتورة شراء ${inv.number}`, metadata: { total } });
      });
      revalidatePath("/purchases/invoices");
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/orders");
      revalidatePath("/accounting/journal");
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
      return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
    }
  });
}

const editSchema = z.object({
  lines: z.array(z.object({
    itemId: z.string().min(1),
    unitPrice: z.coerce.number().min(0),
    taxAmount: z.coerce.number().min(0).default(0),
  })).min(1),
  notes: z.string().optional(),
});

/**
 * Edit a DRAFT purchase invoice to match the supplier's ACTUAL bill — the third leg of
 * the three-way match. Only price and tax are editable; quantity and shipping stay as
 * received (they describe goods that already moved). The gap between this and what the
 * receipt capitalised is settled at posting time as a price variance.
 */
export async function updatePurchaseInvoiceAction(id: string, input: unknown): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status !== "DRAFT") return { error: "لا يمكن تعديل فاتورة مُرحّلة — ألغِها أولاً" };

    try {
      await db.transaction(async (tx) => {
        const [live] = await tx.select({ status: purchaseInvoices.status }).from(purchaseInvoices)
          .where(eq(purchaseInvoices.id, inv.id)).for("update").limit(1);
        if (live?.status !== "DRAFT") throw new Error("لا يمكن تعديل فاتورة مُرحّلة");

        const rows = await tx.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
        const byItem = new Map(parsed.data.lines.map((l) => [l.itemId, l]));

        let subtotal = 0, shipping = 0, discount = 0, tax = 0;
        for (const r of rows) {
          const edit = byItem.get(r.itemId);
          const qty = Number(r.quantity);
          const price = edit ? edit.unitPrice : Number(r.unitPrice);
          const lineTax = edit ? edit.taxAmount : Number(r.taxAmount);
          const ship = Number(r.shippingPerUnit) * qty;
          const disc = Number(r.discountAmount);
          const lineTotal = round2(qty * price + ship - disc + lineTax);
          subtotal += qty * price; shipping += ship; discount += disc; tax += lineTax;
          await tx.update(purchaseInvoiceLines)
            .set({ unitPrice: String(price), taxAmount: String(round2(lineTax)), totalAmount: String(lineTotal) })
            .where(eq(purchaseInvoiceLines.id, r.id));
        }
        subtotal = round2(subtotal); shipping = round2(shipping); discount = round2(discount); tax = round2(tax);
        const totalAmount = round2(subtotal + shipping - discount + tax);

        await tx.update(purchaseInvoices).set({
          subtotal: String(subtotal), shippingAmount: String(shipping), discountAmount: String(discount),
          taxAmount: String(tax), totalAmount: String(totalAmount), balanceDue: String(totalAmount),
          notes: parsed.data.notes ?? inv.notes, updatedAt: new Date(),
        }).where(eq(purchaseInvoices.id, inv.id));

        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `تعديل مسودة فاتورة شراء ${inv.number}`, metadata: { total: totalAmount } });
      });
      revalidatePath("/purchases/invoices");
      revalidatePath(`/purchases/invoices/${encodeURIComponent(inv.number)}`);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر حفظ التعديل" };
    }
  });
}

/**
 * Cancel a POSTED purchase invoice — the "wrong bill" undo. Reverses the journal entry,
 * unwinds any price-variance revaluation, drops the supplier payable, and hands the goods
 * receipt back to "تم الاستلام" so it can be re-billed. Refuses — naming the documents —
 * once a credit note or a payment has been applied to it.
 */
export async function cancelPurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status === "DRAFT") return { error: "المسودة تُحذف مباشرة — لا تحتاج إلغاء" };
    if (inv.status === "CANCELLED") return { error: "الفاتورة ملغية بالفعل" };

    const deps = await purchaseInvoiceDependents(auth.orgId, inv.id);
    if (deps.length) {
      return { error: `لا يمكن إلغاء الفاتورة — مرتبطة بمستندات أخرى: ${dependentsList(deps)}. ألغِ/عالِج هذه المستندات أولاً.` };
    }

    const total = Number(inv.totalAmount);
    const d = new Date();
    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select({ status: purchaseInvoices.status, paid: purchaseInvoices.paidAmount })
          .from(purchaseInvoices).where(eq(purchaseInvoices.id, inv.id)).for("update").limit(1);
        if (locked?.status !== "POSTED" && locked?.status !== "PARTIAL_PAID" && locked?.status !== "PAID") {
          throw new Error("يمكن إلغاء فاتورة مُرحّلة فقط");
        }
        if (Number(locked.paid) > 0.004) throw new Error("الفاتورة مدفوعة جزئياً أو كلياً — ألغِ سند الصرف أولاً");

        const entries = await tx.select({ id: journalEntries.id }).from(journalEntries)
          .where(and(eq(journalEntries.organizationId, auth.orgId), eq(journalEntries.sourceType, "PURCHASE_INVOICE"), eq(journalEntries.sourceId, inv.id), eq(journalEntries.status, "POSTED")));
        for (const e of entries) await reverseEntry(tx, { orgId: auth.orgId, entryId: e.id, date: d, userId: auth.userId, reason: `إلغاء فاتورة شراء ${inv.number}` });

        // Undo the price-variance revaluation this invoice made, if any.
        const varMoves = await tx.select({ itemId: stockMovements.itemId, warehouseId: stockMovements.warehouseId, totalCost: stockMovements.totalCost, unitCost: stockMovements.unitCost })
          .from(stockMovements)
          .where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "PURCHASE_INVOICE_VARIANCE"), eq(stockMovements.referenceId, inv.id)));
        for (const m of varMoves) {
          // unitCost carries the SIGN of the original uplift; totalCost is its magnitude.
          const original = Number(m.unitCost) < 0 ? -Number(m.totalCost) : Number(m.totalCost);
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId, type: "REVALUE",
            quantity: 0, valueDelta: -original, date: d,
            referenceType: "PURCHASE_INVOICE_VARIANCE_CANCEL", referenceId: inv.id, reason: `إلغاء فرق سعر ${inv.number}`,
          });
        }

        // Hand the receipt back so it can be billed again, and reopen the order.
        if (inv.goodsReceiptId) {
          await tx.update(purchaseReceipts).set({ purchaseInvoiceId: null, status: "RECEIVED" })
            .where(and(eq(purchaseReceipts.id, inv.goodsReceiptId), eq(purchaseReceipts.organizationId, auth.orgId)));
          const [grn] = await tx.select({ purchaseOrderId: purchaseReceipts.purchaseOrderId }).from(purchaseReceipts)
            .where(eq(purchaseReceipts.id, inv.goodsReceiptId)).limit(1);
          if (grn?.purchaseOrderId) {
            const grnLines = await tx.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity })
              .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, inv.goodsReceiptId));
            const poLines = await tx.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId })
              .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));
            const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
            for (const gl of grnLines) {
              const pol = poByItem.get(gl.itemId);
              if (pol) await tx.update(purchaseOrderLines).set({ invoicedQty: sql`GREATEST(0, ${purchaseOrderLines.invoicedQty} - ${Number(gl.quantity)})` }).where(eq(purchaseOrderLines.id, pol.id));
            }
            await recomputePurchaseOrderStatus(tx, grn.purchaseOrderId);
          }
        }

        await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${total}` }).where(eq(suppliers.id, inv.supplierId));
        await tx.update(purchaseInvoices).set({ status: "CANCELLED", balanceDue: "0" }).where(eq(purchaseInvoices.id, inv.id));
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CANCEL", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `إلغاء فاتورة شراء ${inv.number} وعكس أثرها`, metadata: { total } });
      });
      revalidatePath("/purchases/invoices");
      revalidatePath("/purchases/receipts");
      revalidatePath("/purchases/orders");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر إلغاء الفاتورة" };
    }
  });
}

/** Delete a DRAFT purchase invoice (nothing posted yet). Posted invoices are immutable. */
export async function deletePurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select().from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status !== "DRAFT") return { error: "لا يمكن حذف فاتورة مُرحّلة" };
    try {
      await db.transaction(async (tx) => {
        await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
        await tx.delete(purchaseInvoices).where(eq(purchaseInvoices.id, inv.id));
        // Reopen the source order if this draft came from a direct conversion (Audit#7).
        if (inv.purchaseOrderId) {
          await tx.update(purchaseOrders).set({ status: "CONFIRMED" })
            .where(and(eq(purchaseOrders.id, inv.purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId), eq(purchaseOrders.status, "INVOICED")));
        }
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `حذف مسودة فاتورة شراء ${inv.number}` });
      });
      revalidatePath("/purchases/invoices");
      revalidatePath("/purchases/orders");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
    }
  });
}

/** Bulk post / delete purchase invoices (drafts only). Skips ineligible rows. */
export async function bulkPurchaseInvoicesAction(op: "post" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "purchases.create" : "accounting.post");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    if (!ids.length) return { error: "لم تُحدّد أي فواتير" };
    let count = 0;
    let lastError: string | undefined;
    for (const id of ids) {
      const r = op === "post" ? await postPurchaseInvoiceAction(id) : await deletePurchaseInvoiceAction(id);
      if (r.ok) count++;
      else lastError = r.error;
    }
    if (count === 0) return { error: lastError ?? "تعذّر التنفيذ" };
    return { ok: true, count };
  });
}
