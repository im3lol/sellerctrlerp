"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesReturns, salesReturnLines, salesInvoices, salesInvoiceLines, customers, accounts, warehouses, journalEntries, stockMovements } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry, reverseEntry } from "@/lib/erp/posting";
import { postStockMovement, currentStock } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

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

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(salesReturns).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT",
        customerId: inv.customerId, warehouseId: wh?.id ?? "", salesInvoiceId: inv.id,
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

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["4102", "2102", "1103", "1104", "5101"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
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

      const moves = await tx.select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost, type: stockMovements.type, warehouseId: stockMovements.warehouseId })
        .from(stockMovements).where(and(eq(stockMovements.organizationId, auth.orgId), eq(stockMovements.referenceType, "SALES_RETURN"), eq(stockMovements.referenceId, ret.id)));
      for (const m of moves) {
        await postStockMovement(tx, { orgId: auth.orgId, itemId: m.itemId, warehouseId: m.warehouseId, type: m.type === "IN" ? "OUT" : "IN", quantity: Number(m.quantity), unitCost: Number(m.unitCost), date: d, referenceType: "SALES_RETURN_CANCEL", referenceId: ret.id, reason: `إلغاء مرتجع ${ret.number}` });
      }

      if (ret.customerId) await tx.update(customers).set({ balance: sql`${customers.balance} + ${total}` }).where(eq(customers.id, ret.customerId));
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
