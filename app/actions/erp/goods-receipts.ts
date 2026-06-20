"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines,
  purchaseInvoices, purchaseInvoiceLines, suppliers, accounts,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

/** Receive a confirmed purchase order in full: stock in at cost + Dr Inventory / Cr GRNI. */
export async function createReceiptFromOrderAction(purchaseOrderId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, purchaseOrderId), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
  if (!po) return { error: "الأمر غير موجود" };
  if (po.status !== "CONFIRMED") return { error: "يمكن الاستلام من أمر مؤكّد فقط" };

  const lines = await db.select({ itemId: purchaseOrderLines.itemId, quantity: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, discountAmount: purchaseOrderLines.discountAmount })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "2103"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1104"] || !A["2103"]) return { error: "حسابات الاستلام غير مكتملة (المخزون/بضاعة لم تُفوتر)." };

  const number = await nextNumber("GRN", auth.orgId, new Date(po.date).getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [grn] = await tx.insert(purchaseReceipts).values({
        organizationId: auth.orgId, number, date: new Date(po.date), status: "RECEIVED",
        purchaseOrderId: po.id, supplierId: po.supplierId, warehouseId: po.warehouseId, notes: `استلام أمر ${po.number}`,
      }).returning({ id: purchaseReceipts.id });
      await tx.insert(purchaseReceiptLines).values(lines.map((l) => ({ purchaseReceiptId: grn.id, itemId: l.itemId, quantity: String(l.quantity) })));

      let received = 0;
      for (const l of lines) {
        const qty = Number(l.quantity);
        const lineNet = qty * Number(l.unitPrice) - Number(l.discountAmount);
        received += lineNet;
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: po.warehouseId, type: "IN",
          quantity: qty, unitCost: lineNet / qty, date: new Date(po.date),
          referenceType: "GOODS_RECEIPT", referenceId: grn.id, reason: `استلام ${number}`,
        });
      }
      received = round2(received);
      if (received > 0) {
        await postEntry(tx, {
          orgId: auth.orgId, date: new Date(po.date), sourceType: "GOODS_RECEIPT", sourceId: grn.id,
          description: `استلام بضاعة ${number}`, journalType: "PURCHASE", userId: auth.userId,
          lines: [
            { accountId: A["1104"], debit: received, credit: 0, description: `مخزون مستلم ${number}` },
            { accountId: A["2103"], debit: 0, credit: received, description: `بضاعة لم تُفوتر ${number}` },
          ],
        });
      }
      await tx.update(purchaseOrders).set({ status: "RECEIVED" }).where(eq(purchaseOrders.id, po.id));
      return grn.id;
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الاستلام" };
  }
}

/** Bill a goods receipt: POSTED purchase invoice that clears GRNI → AP (no stock). */
export async function convertReceiptToInvoiceAction(receiptId: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const [grn] = await db.select().from(purchaseReceipts)
    .where(and(eq(purchaseReceipts.id, receiptId), eq(purchaseReceipts.organizationId, auth.orgId))).limit(1);
  if (!grn) return { error: "الاستلام غير موجود" };
  if (grn.purchaseInvoiceId) return { error: "الاستلام مفوتر بالفعل" };
  if (!grn.purchaseOrderId) return { error: "الاستلام غير مرتبط بأمر شراء" };

  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, grn.purchaseOrderId)).limit(1);
  if (!po) return { error: "أمر الشراء غير موجود" };
  const poLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, po.id));

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2103", "1107", "2101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["2103"] || !A["2101"]) return { error: "حسابات الترحيل غير مكتملة" };

  const total = Number(po.totalAmount);
  const tax = Number(po.taxAmount);
  const net = round2(Number(po.subtotal) - Number(po.discountAmount));
  const number = await nextNumber("PI", auth.orgId, new Date(po.date).getFullYear());

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: auth.orgId, number, supplierId: po.supplierId, warehouseId: po.warehouseId, goodsReceiptId: grn.id,
        date: new Date(po.date), status: "POSTED", subtotal: po.subtotal, taxAmount: po.taxAmount, totalAmount: po.totalAmount,
        paidAmount: "0", balanceDue: po.totalAmount, notes: `فاتورة استلام ${grn.number}`,
      }).returning({ id: purchaseInvoices.id });
      await tx.insert(purchaseInvoiceLines).values(poLines.map((l) => ({
        purchaseInvoiceId: inv.id, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice,
        discountAmount: l.discountAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount,
      })));

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
      await tx.update(purchaseReceipts).set({ purchaseInvoiceId: inv.id }).where(eq(purchaseReceipts.id, grn.id));
      await tx.update(purchaseOrders).set({ status: "INVOICED" }).where(eq(purchaseOrders.id, po.id));
      return inv.id;
    });
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/invoices");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}
