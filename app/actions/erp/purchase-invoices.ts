"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

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

      await tx.update(suppliers).set({ balance: sql`${suppliers.balance} + ${totalAmount}` }).where(eq(suppliers.id, supplierId));
      return inv.id;
    });
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/purchases");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "رقم الفاتورة مستخدم — أعد المحاولة" : "تعذّر حفظ الفاتورة" };
  }
}

/**
 * Post a DRAFT purchase invoice:
 *   Dr المخزون (1104) = الصافي
 *   Dr ضريبة المدخلات (1107) = الضريبة
 *   Cr الموردون (2101) = الإجمالي
 */
export async function postPurchaseInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.post");
  if ("error" in auth) return auth;

  const [inv] = await db.select().from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, id), eq(purchaseInvoices.organizationId, auth.orgId))).limit(1);
  if (!inv) return { error: "الفاتورة غير موجودة" };
  if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

  // Invoice lines receive stock into the inventory ledger (perpetual inventory).
  const invLines = await db
    .select({
      itemId: purchaseInvoiceLines.itemId,
      quantity: purchaseInvoiceLines.quantity,
      unitPrice: purchaseInvoiceLines.unitPrice,
      discountAmount: purchaseInvoiceLines.discountAmount,
    })
    .from(purchaseInvoiceLines)
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1104", "1107", "2101"])));
  const byCode = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!byCode["1104"] || !byCode["2101"]) return { error: "حسابات الترحيل غير مكتملة (المخزون/الموردون)." };

  const total = Number(inv.totalAmount);
  const tax = Number(inv.taxAmount);
  const net = Number(inv.subtotal) - Number(inv.discountAmount);

  const lines = [
    { accountId: byCode["1104"], debit: net, credit: 0, description: `مشتريات ${inv.number}` },
    { accountId: byCode["2101"], debit: 0, credit: total, description: `مستحق للمورد ${inv.number}` },
  ];
  if (tax > 0 && byCode["1107"]) lines.splice(1, 0, { accountId: byCode["1107"], debit: tax, credit: 0, description: `ضريبة مدخلات ${inv.number}` });

  try {
    await db.transaction(async (tx) => {
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(inv.date), sourceType: "PURCHASE_INVOICE", sourceId: inv.id,
        description: `فاتورة شراء ${inv.number}`, journalType: "PURCHASE", lines,
      });
      // Receive each line into stock at its net unit cost (matches the 1104 debit).
      for (const l of invLines) {
        const qty = Number(l.quantity);
        if (qty <= 0) continue;
        const lineNet = qty * Number(l.unitPrice) - Number(l.discountAmount);
        await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: inv.warehouseId, type: "IN",
          quantity: qty, unitCost: lineNet / qty, date: new Date(inv.date),
          referenceType: "PURCHASE_INVOICE", referenceId: inv.id, reason: `استلام شراء ${inv.number}`,
        });
      }
      await tx.update(purchaseInvoices).set({ status: "POSTED" }).where(eq(purchaseInvoices.id, inv.id));
    });
    revalidatePath("/erp/purchases/invoices");
    revalidatePath("/erp/accounting/journal");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
    return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
  }
}
