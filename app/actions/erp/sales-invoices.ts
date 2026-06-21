"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesInvoices, salesInvoiceLines, customers, accounts, warehouses, deliveryNotes, deliveryNoteLines, salesOrders, salesOrderLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputeSalesOrderStatus } from "@/lib/erp/sales-order";

export type SaveInvoiceState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
});

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Next invoice number SI-YYYY-NNNN for the org (per-year sequence). */
async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "SI", year);
}

export async function createSalesInvoiceAction(input: unknown): Promise<SaveInvoiceState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { customerId, date, notes, lines } = parsed.data;

  // Verify the customer belongs to the active org.
  const [cust] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.organizationId, auth.orgId)))
    .limit(1);
  if (!cust) return { error: "العميل غير موجود في هذه المؤسسة" };

  const computed = lines.map((l) => ({
    ...l,
    totalAmount: round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount),
  }));
  const subtotal = round2(computed.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const discountAmount = round2(computed.reduce((s, l) => s + l.discountAmount, 0));
  const taxAmount = round2(computed.reduce((s, l) => s + l.taxAmount, 0));
  const totalAmount = round2(subtotal - discountAmount + taxAmount);

  const invoiceDate = new Date(date);
  const number = await nextNumber(auth.orgId, invoiceDate.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(salesInvoices)
        .values({
          organizationId: auth.orgId,
          number,
          customerId,
          date: invoiceDate,
          status: "DRAFT",
          subtotal: String(subtotal),
          discountAmount: String(discountAmount),
          taxAmount: String(taxAmount),
          totalAmount: String(totalAmount),
          paidAmount: "0",
          balanceDue: String(totalAmount),
          notes: notes || null,
        })
        .returning({ id: salesInvoices.id });

      await tx.insert(salesInvoiceLines).values(
        computed.map((l) => ({
          salesInvoiceId: inv.id,
          itemId: l.itemId,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          discountAmount: String(l.discountAmount),
          taxAmount: String(l.taxAmount),
          totalAmount: String(l.totalAmount),
        })),
      );

      // A DRAFT invoice has no subledger effect — the customer balance is
      // established only when the invoice is posted (see postSalesInvoiceAction).
      return inv.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_INVOICE", entityId: id, entityNumber: number, summary: `إنشاء فاتورة بيع ${number} (مسودة)`, metadata: { total: totalAmount } });
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/sales");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الفاتورة مستخدم — أعد المحاولة" : "تعذّر حفظ الفاتورة" };
  }
}

/**
 * Post a DRAFT sales invoice. Revenue is always recognised:
 *   Dr العملاء (1103) = الإجمالي · Cr إيرادات (4101) = الصافي · Cr ضريبة (2102)
 * Inventory/COGS depends on the source:
 *  • Billed from a delivery (deliveryNoteId set): stock was already issued + COGS
 *    posted at the delivery, so NO stock here — just mark the delivery INVOICED
 *    and advance the order's invoicedQty.
 *  • Standalone (no delivery): issue stock OUT at WAC + Dr COGS (5101) /
 *    Cr Inventory (1104).
 */
export async function postSalesInvoiceAction(id: string): Promise<ActionState & { entryId?: string }> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [inv] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId)))
    .limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

  const accs = await db
    .select({ code: accounts.code, id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103", "4101", "2102", "5101", "1104"])));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!byCode["1103"] || !byCode["4101"]) {
    return { error: "حسابات الترحيل غير مكتملة (العملاء/المبيعات). أضِفها في دليل الحسابات." };
  }

  const total = Number(inv.totalAmount);
  const tax = Number(inv.taxAmount);
  const net = Number(inv.subtotal) - Number(inv.discountAmount);
  const fromDelivery = Boolean(inv.deliveryNoteId);

  const lines = [
    { accountId: byCode["1103"], debit: total, credit: 0, description: `فاتورة بيع ${inv.number}` },
    { accountId: byCode["4101"], debit: 0, credit: net, description: `إيراد مبيعات ${inv.number}` },
  ];
  if (tax > 0 && byCode["2102"]) {
    lines.push({ accountId: byCode["2102"], debit: 0, credit: tax, description: `ضريبة مخرجات ${inv.number}` });
  }

  try {
    const entryId = await db.transaction(async (tx) => {
      const eid = await postEntry(tx, {
        orgId: auth.orgId, date: new Date(inv.date), sourceType: "SALES_INVOICE", sourceId: inv.id,
        description: `فاتورة بيع ${inv.number}`, journalType: "SALES", userId: auth.userId, lines,
      });

      if (fromDelivery) {
        // Stock + COGS already posted at the delivery — settle the order, no stock here.
        const [dn] = await tx.select().from(deliveryNotes).where(eq(deliveryNotes.id, inv.deliveryNoteId!)).limit(1);
        await tx.update(deliveryNotes).set({ salesInvoiceId: inv.id, status: "INVOICED" }).where(eq(deliveryNotes.id, inv.deliveryNoteId!));
        if (dn?.salesOrderId) {
          const dnLines = await tx.select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity })
            .from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, dn.id));
          const soLines = await tx.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
            .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, dn.salesOrderId));
          const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
          for (const dl of dnLines) {
            const sol = soByItem.get(dl.itemId);
            if (sol) await tx.update(salesOrderLines).set({ invoicedQty: sql`${salesOrderLines.invoicedQty} + ${Number(dl.quantity)}` }).where(eq(salesOrderLines.id, sol.id));
          }
          await recomputeSalesOrderStatus(tx, dn.salesOrderId);
          await linkDocuments(tx, { orgId: auth.orgId, fromType: "DELIVERY_NOTE", fromId: dn.id, fromNumber: dn.number, toType: "SALES_INVOICE", toId: inv.id, toNumber: inv.number, relation: "INVOICES" });
        }
      } else {
        // Standalone invoice: issue stock OUT at WAC + COGS.
        const invLines = await tx.select({ itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity })
          .from(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
        const [wh] = await tx.select({ id: warehouses.id }).from(warehouses)
          .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).limit(1);
        let cogs = 0;
        if (wh && byCode["5101"] && byCode["1104"]) {
          for (const l of invLines) {
            const qty = Number(l.quantity);
            if (qty <= 0) continue;
            const r = await postStockMovement(tx, {
              orgId: auth.orgId, itemId: l.itemId, warehouseId: wh.id, type: "OUT",
              quantity: qty, date: new Date(inv.date), referenceType: "SALES_INVOICE", referenceId: inv.id, reason: `صرف بيع ${inv.number}`,
            });
            cogs += r.totalCost;
          }
          if (cogs > 0) {
            await postEntry(tx, {
              orgId: auth.orgId, date: new Date(inv.date), sourceType: "SALES_COGS", sourceId: inv.id,
              description: `تكلفة بضاعة مباعة ${inv.number}`, journalType: "GENERAL",
              lines: [
                { accountId: byCode["5101"], debit: cogs, credit: 0, description: `ت.ب.م ${inv.number}` },
                { accountId: byCode["1104"], debit: 0, credit: cogs, description: `صرف مخزون ${inv.number}` },
              ],
            });
          }
        }
      }

      await tx.update(customers).set({ balance: sql`${customers.balance} + ${total}` }).where(eq(customers.id, inv.customerId));
      await tx.update(salesInvoices).set({ status: "POSTED" }).where(eq(salesInvoices.id, inv.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "SALES_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `ترحيل فاتورة بيع ${inv.number}`, metadata: { total } });
      return eid;
    });
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/orders");
    revalidatePath("/erp/accounting/journal");
    return { ok: true, entryId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
    return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
  }
}

/** Delete a DRAFT sales invoice (nothing posted yet). Posted invoices are immutable. */
export async function deleteSalesInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const [inv] = await db.select().from(salesInvoices)
    .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "لا يمكن حذف فاتورة مُرحّلة" };
  try {
    await db.transaction(async (tx) => {
      await tx.delete(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
      await tx.delete(salesInvoices).where(eq(salesInvoices.id, inv.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "SALES_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `حذف مسودة فاتورة بيع ${inv.number}` });
    });
    revalidatePath("/erp/sales/invoices");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
  }
}

/** Bulk post / delete sales invoices (drafts only). Skips ineligible rows. */
export async function bulkSalesInvoicesAction(op: "post" | "delete", ids: string[]): Promise<ActionState & { count?: number }> {
  const auth = await authorizeErp(op === "delete" ? "sales.create" : "accounting.post");
  if ("error" in auth) return auth;
  if (!ids.length) return { error: "لم تُحدّد أي فواتير" };
  let count = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = op === "post" ? await postSalesInvoiceAction(id) : await deleteSalesInvoiceAction(id);
    if (r.ok) count++;
    else lastError = r.error;
  }
  if (count === 0) return { error: lastError ?? "تعذّر التنفيذ" };
  return { ok: true, count };
}
