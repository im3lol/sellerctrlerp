"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, accounts, purchaseReceipts, purchaseReceiptLines, purchaseOrders, purchaseOrderLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputePurchaseOrderStatus } from "@/lib/erp/purchase-order";

export type SaveInvoiceState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
});
const schema = z.object({
  supplierId: z.string().min(1, "اختر المورد"),
  warehouseId: z.string().min(1, "اختر المستودع"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "PI", year);
}

export async function createPurchaseInvoiceAction(input: unknown): Promise<SaveInvoiceState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supplierId, warehouseId, date, notes, lines } = parsed.data;

  const [sup] = await db.select({ id: suppliers.id }).from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.organizationId, auth.orgId))).limit(1);
  if (!sup) return { error: "المورد غير موجود في هذه المؤسسة" };

  const computed = lines.map((l) => ({ ...l, totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount) }));
  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal - discountAmount + taxAmount);

  const invoiceDate = new Date(date);
  const number = await nextNumber(auth.orgId, invoiceDate.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(purchaseInvoices).values({
        organizationId: auth.orgId, number, supplierId, warehouseId, date: invoiceDate, status: "DRAFT",
        subtotal: String(subtotal), discountAmount: String(discountAmount), taxAmount: String(taxAmount),
        totalAmount: String(totalAmount), paidAmount: "0", balanceDue: String(totalAmount), notes: notes || null,
      }).returning({ id: purchaseInvoices.id });

      await tx.insert(purchaseInvoiceLines).values(computed.map((l) => ({
        purchaseInvoiceId: inv.id, itemId: l.itemId, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
        discountAmount: String(l.discountAmount), taxAmount: String(l.taxAmount), totalAmount: String(l.totalAmount),
      })));

      // A DRAFT invoice has no subledger effect — the supplier balance is
      // established only when the invoice is posted (see postPurchaseInvoiceAction).
      return inv.id;
    });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_INVOICE", entityId: id, entityNumber: number, summary: `إنشاء فاتورة شراء ${number} (مسودة)`, metadata: { total: totalAmount } });
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/purchases");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الفاتورة مستخدم — أعد المحاولة" : "تعذّر حفظ الفاتورة" };
  }
}

/**
 * Post a DRAFT purchase invoice. Two paths:
 *  • Billed from a goods receipt (goodsReceiptId set): goods are already in
 *    stock (the GRN did Dr 1104 / Cr 2103), so posting only clears GRNI →
 *      Dr بضاعة لم تُفوتر (2103) = الصافي
 *      Dr ضريبة المدخلات (1107) = الضريبة
 *      Cr الموردون (2101) = الإجمالي
 *    No stock movement; marks the receipt INVOICED, bumps the order's invoicedQty.
 *  • Standalone (no receipt): receives stock + recognises inventory →
 *      Dr المخزون (1104) = الصافي · Dr ضريبة (1107) · Cr الموردون (2101)
 */
export async function postPurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

  const total = Number(inv.totalAmount);
  const tax = Number(inv.taxAmount);
  const net = Number(inv.subtotal) + Number(inv.shippingAmount) - Number(inv.discountAmount);
  const fromReceipt = Boolean(inv.goodsReceiptId);

  // GRN path debits GRNI (2103); standalone path debits Inventory (1104) + adds stock.
  const codes = fromReceipt ? ["2103", "1107", "2101"] : ["1104", "1107", "2101"];
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, codes)));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const debitAcc = fromReceipt ? byCode["2103"] : byCode["1104"];
  if (!debitAcc || !byCode["2101"]) return { error: "حسابات الترحيل غير مكتملة." };

  const lines = [
    { accountId: debitAcc, debit: net, credit: 0, description: fromReceipt ? `تسوية بضاعة مستلمة ${inv.number}` : `مشتريات ${inv.number}` },
    { accountId: byCode["2101"], debit: 0, credit: total, description: `مستحق للمورد ${inv.number}` },
  ];
  if (tax > 0 && byCode["1107"]) lines.splice(1, 0, { accountId: byCode["1107"], debit: tax, credit: 0, description: `ضريبة مدخلات ${inv.number}` });

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(inv.date), sourceType: "PURCHASE_INVOICE", sourceId: inv.id,
        description: `فاتورة شراء ${inv.number}`, journalType: "PURCHASE", userId: auth.userId, lines,
      });

      if (fromReceipt) {
        // Goods already received by the GRN — just settle GRNI and advance the order.
        const [grn] = await tx.select().from(purchaseReceipts).where(eq(purchaseReceipts.id, inv.goodsReceiptId!)).limit(1);
        await tx.update(purchaseReceipts).set({ purchaseInvoiceId: inv.id, status: "INVOICED" }).where(eq(purchaseReceipts.id, inv.goodsReceiptId!));
        if (grn?.purchaseOrderId) {
          const grnLines = await tx.select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity })
            .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));
          const poLines = await tx.select({ id: purchaseOrderLines.id, itemId: purchaseOrderLines.itemId })
            .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));
          const poByItem = new Map(poLines.map((l) => [l.itemId, l]));
          for (const gl of grnLines) {
            const pol = poByItem.get(gl.itemId);
            if (pol) await tx.update(purchaseOrderLines).set({ invoicedQty: sql`${purchaseOrderLines.invoicedQty} + ${Number(gl.quantity)}` }).where(eq(purchaseOrderLines.id, pol.id));
          }
          await recomputePurchaseOrderStatus(tx, grn.purchaseOrderId);
          await linkDocuments(tx, { orgId: auth.orgId, fromType: "GOODS_RECEIPT", fromId: grn.id, fromNumber: grn.number, toType: "PURCHASE_INVOICE", toId: inv.id, toNumber: inv.number, relation: "INVOICES" });
        }
      } else {
        // Standalone invoice: receive each line into stock at its net unit cost.
        const invLines = await tx
          .select({ itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, discountAmount: purchaseInvoiceLines.discountAmount })
          .from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
        for (const l of invLines) {
          const qty = Number(l.quantity);
          if (qty <= 0) continue;
          const lineNet = qty * Number(l.unitPrice) - Number(l.discountAmount);
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: l.itemId, warehouseId: inv.warehouseId, type: "IN",
            quantity: qty, unitCost: lineNet / qty, date: new Date(inv.date),
            deriveExpiryFromShelfLife: true, // perishables get expiry from shelf-life (no per-line UI here)
            referenceType: "PURCHASE_INVOICE", referenceId: inv.id, reason: `استلام شراء ${inv.number}`,
          });
        }
      }

      // Establish the supplier payable now (not at draft).
      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${total}` }).where(eq(suppliers.id, inv.supplierId));
      await tx.update(purchaseInvoices).set({ status: "POSTED" }).where(eq(purchaseInvoices.id, inv.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `ترحيل فاتورة شراء ${inv.number}`, metadata: { total } });
    });
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/purchases/receipts");
    revalidatePath("/erp/purchases/orders");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
    return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
  }
}

/** Delete a DRAFT purchase invoice (nothing posted yet). Posted invoices are immutable. */
export async function deletePurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;
  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "لا يمكن حذف فاتورة مُرحّلة" };
  try {
    await db.transaction(async (tx) => {
      await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
      await tx.delete(purchaseInvoices).where(eq(purchaseInvoices.id, inv.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "PURCHASE_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `حذف مسودة فاتورة شراء ${inv.number}` });
    });
    revalidatePath("/erp/purchases/invoices");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
  }
}

/** Bulk post / delete purchase invoices (drafts only). Skips ineligible rows. */
export async function bulkPurchaseInvoicesAction(op: "post" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "purchases.create" : "accounting.post");
  if ("error" in auth) return auth;
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
}
