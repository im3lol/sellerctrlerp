"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { purchaseReturns, purchaseReturnLines, purchaseInvoices, purchaseInvoiceLines, suppliers, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";

export type SaveReturnState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});
const schema = z.object({
  purchaseInvoiceId: z.string().min(1, "اختر الفاتورة"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "PR", year);
}

/**
 * Create a purchase return (debit note) as a DRAFT — header + lines only.
 * No GL, no stock, no balance change until it is confirmed.
 */
export async function createPurchaseReturnAction(input: unknown): Promise<SaveReturnState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { purchaseInvoiceId, date, notes, lines } = parsed.data;

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, purchaseInvoiceId), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  const invLines = await db.select({ itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity })
    .from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));
  const boughtByItem = new Map<string, number>();
  for (const l of invLines) boughtByItem.set(l.itemId, (boughtByItem.get(l.itemId) ?? 0) + Number(l.quantity));
  for (const l of lines) {
    if (l.quantity > (boughtByItem.get(l.itemId) ?? 0) + 1e-9) return { error: "الكمية المرتجعة أكبر من المشتراة" };
  }

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const d = new Date(date);
  const number = await nextNumber(auth.orgId, d.getFullYear());

  try {
    const id = await db.transaction(async (tx) => {
      const [ret] = await tx.insert(purchaseReturns).values({
        organizationId: auth.orgId, number, date: d, status: "DRAFT",
        supplierId: inv.supplierId, warehouseId: inv.warehouseId, purchaseInvoiceId: inv.id,
        totalAmount: String(total), notes: notes || null,
      }).returning({ id: purchaseReturns.id });

      await tx.insert(purchaseReturnLines).values(lines.map((l) => ({
        purchaseReturnId: ret.id, itemId: l.itemId, quantity: String(l.quantity),
        unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
      })));
      return ret.id;
    });

    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "PURCHASE_RETURN", entityId: id, entityNumber: number, summary: `إنشاء مرتجع مشتريات ${number} (مسودة)`, metadata: { total, invoice: inv.number } });
    revalidatePath("/erp/purchases/returns");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر حفظ المرتجع" };
  }
}

/**
 * Confirm (post) a DRAFT purchase return — atomic + idempotent:
 *   Dr الموردون (2101) = total · Cr المخزون (1104) = net · Cr ضريبة المدخلات (1107) = tax
 *   + issue stock out at the credited unit price (keeps GL inventory == ledger).
 *   + reduce the supplier balance. Sets status = POSTED.
 */
export async function confirmPurchaseReturnAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.confirm");
  if ("error" in auth) return auth;

  const [ret] = await db.select().from(purchaseReturns)
    .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.organizationId, auth.orgId))).limit(1);
  if (!ret) return { error: "المرتجع غير موجود" };
  if (ret.status !== "DRAFT") return { error: "المرتجع مُرحّل بالفعل" };

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, ret.purchaseInvoiceId ?? ""), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") return { error: "لا يمكن إرجاع فاتورة غير مُرحّلة" };

  const retLines = await db.select({ itemId: purchaseReturnLines.itemId, quantity: purchaseReturnLines.quantity, unitPrice: purchaseReturnLines.unitPrice })
    .from(purchaseReturnLines).where(eq(purchaseReturnLines.purchaseReturnId, id));
  if (retLines.length === 0) return { error: "لا توجد بنود في المرتجع" };
  const lines = retLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) }));

  const net = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const subtotal = Number(inv.subtotal) || 0;
  const taxRate = subtotal > 0 ? Number(inv.taxAmount) / subtotal : 0;
  const tax = round2(net * taxRate);
  const total = round2(net + tax);

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["2101", "1104", "2103", "1107"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  // Money-side return: from a GRN-billed invoice it restores GRNI (2103); a standalone
  // invoice (which received stock itself) credits Inventory (1104) and issues stock out.
  const fromReceipt = Boolean(inv.goodsReceiptId);
  const creditAcc = fromReceipt ? A["2103"] : A["1104"];
  if (!A["2101"] || !creditAcc) return { error: "حسابات الترحيل غير مكتملة." };

  const whId = ret.warehouseId;
  const d = ret.date instanceof Date ? ret.date : new Date(ret.date);

  try {
    await db.transaction(async (tx) => {
      if (!fromReceipt) {
        // Standalone invoice: take the goods back out of stock at the credited price.
        for (const l of lines) {
          await postStockMovement(tx, {
            orgId: auth.orgId, itemId: l.itemId, warehouseId: whId, type: "OUT",
            quantity: l.quantity, unitCost: l.unitPrice, date: d,
            referenceType: "PURCHASE_RETURN", referenceId: ret.id, reason: `مرتجع شراء ${ret.number}`,
          });
        }
      }

      const glLines = [
        { accountId: A["2101"], debit: total, credit: 0, description: `إشعار مدين ${inv.number}` },
        { accountId: creditAcc, debit: 0, credit: net, description: fromReceipt ? `تسوية بضاعة لم تُفوتر ${ret.number}` : `إرجاع مخزون ${ret.number}` },
      ];
      if (tax > 0 && A["1107"]) glLines.push({ accountId: A["1107"], debit: 0, credit: tax, description: `عكس ضريبة مدخلات ${ret.number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: d, sourceType: "PURCHASE_RETURN", sourceId: ret.id,
        description: `مرتجع مشتريات ${ret.number} — فاتورة ${inv.number}`, journalType: "PURCHASE", userId: auth.userId, lines: glLines,
      });

      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} - ${total}` }).where(eq(suppliers.id, ret.supplierId));
      await tx.update(purchaseReturns).set({ status: "POSTED" }).where(eq(purchaseReturns.id, ret.id));
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_RETURN", entityId: ret.id, entityNumber: ret.number, summary: `تأكيد وترحيل مرتجع مشتريات ${ret.number}`, metadata: { total, invoice: inv.number } });
    });

    revalidatePath("/erp/purchases/returns");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل المرتجع" };
  }
}

export type ReturnPick = { itemId: string; quantity: number; unitPrice: number };

/**
 * One-shot return from a posted purchase invoice: create the debit-note draft for
 * the picked quantities and immediately confirm (post) it. Used by the "مرتجع"
 * shortcut on the invoice page.
 */
export async function returnFromPurchaseInvoiceAction(invoiceId: string, picks: ReturnPick[], date?: string): Promise<ActionState & { id?: string }> {
  const lines = picks.filter((p) => p.quantity > 0);
  if (lines.length === 0) return { error: "حدّد كمية مرتجعة لبند واحد على الأقل" };
  const created = await createPurchaseReturnAction({ purchaseInvoiceId: invoiceId, date: date || new Date().toISOString().slice(0, 10), lines });
  if (!created.ok || !created.id) return created;
  const posted = await confirmPurchaseReturnAction(created.id);
  if (!posted.ok) return { error: posted.error, id: created.id };
  revalidatePath("/erp/purchases/invoices");
  return { ok: true, id: created.id };
}

/** Delete a DRAFT purchase return (header + lines). Posted returns are immutable. */
export async function deletePurchaseReturnAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.create");
  if ("error" in auth) return auth;

  const [ret] = await db.select({ status: purchaseReturns.status }).from(purchaseReturns)
    .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.organizationId, auth.orgId))).limit(1);
  if (!ret) return { error: "المرتجع غير موجود" };
  if (ret.status !== "DRAFT") return { error: "لا يمكن حذف مرتجع مُرحّل" };

  await db.transaction(async (tx) => {
    await tx.delete(purchaseReturnLines).where(eq(purchaseReturnLines.purchaseReturnId, id));
    await tx.delete(purchaseReturns).where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.organizationId, auth.orgId)));
  });

  revalidatePath("/erp/purchases/returns");
  return { ok: true };
}
