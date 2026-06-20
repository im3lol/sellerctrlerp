"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import {
  deliveryNotes, deliveryNoteLines, salesOrders, salesOrderLines,
  salesInvoices, salesInvoiceLines, customers, accounts, warehouses,
} from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";

const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

/** Deliver a confirmed sales order in full: issue stock at WAC + post COGS. */
export async function createDeliveryFromOrderAction(salesOrderId: string): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "CONFIRMED") return { error: "يمكن التسليم من أمر مؤكّد فقط" };

  const lines = await db.select({ itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["5101", "1104"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).orderBy(asc(warehouses.code)).limit(1);
  if (!wh) return { error: "لا يوجد مستودع" };

  const number = await nextNumber("DLV", auth.orgId, new Date(so.date).getFullYear());
  try {
    const id = await db.transaction(async (tx) => {
      const [dn] = await tx.insert(deliveryNotes).values({
        organizationId: auth.orgId, number, date: new Date(so.date), status: "DELIVERED",
        salesOrderId: so.id, customerId: so.customerId, warehouseId: wh.id, notes: `تسليم أمر ${so.number}`,
      }).returning({ id: deliveryNotes.id });
      await tx.insert(deliveryNoteLines).values(lines.map((l) => ({ deliveryNoteId: dn.id, itemId: l.itemId, quantity: String(l.quantity) })));

      let cogs = 0;
      for (const l of lines) {
        const r = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: l.itemId, warehouseId: wh.id, type: "OUT",
          quantity: Number(l.quantity), date: new Date(so.date),
          referenceType: "DELIVERY", referenceId: dn.id, reason: `تسليم ${number}`,
        });
        cogs += r.totalCost;
      }
      if (cogs > 0 && A["5101"] && A["1104"]) {
        await postEntry(tx, {
          orgId: auth.orgId, date: new Date(so.date), sourceType: "DELIVERY_COGS", sourceId: dn.id,
          description: `ت.ب.م تسليم ${number}`, journalType: "GENERAL",
          lines: [
            { accountId: A["5101"], debit: cogs, credit: 0, description: `ت.ب.م ${number}` },
            { accountId: A["1104"], debit: 0, credit: cogs, description: `صرف مخزون ${number}` },
          ],
        });
      }
      await tx.update(salesOrders).set({ status: "DELIVERED" }).where(eq(salesOrders.id, so.id));
      return dn.id;
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء التسليم" };
  }
}

/** Bill a delivery: create a POSTED sales invoice (revenue/AR only — stock + COGS
 *  already posted at delivery). */
export async function convertDeliveryToInvoiceAction(deliveryId: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  if (dn.salesInvoiceId) return { error: "التسليم مفوتر بالفعل" };
  if (!dn.salesOrderId) return { error: "التسليم غير مرتبط بأمر بيع" };

  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId)).limit(1);
  if (!so) return { error: "أمر البيع غير موجود" };
  const soLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103", "4101", "2102"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1103"] || !A["4101"]) return { error: "حسابات الترحيل غير مكتملة" };

  const total = Number(so.totalAmount);
  const tax = Number(so.taxAmount);
  const net = round2(Number(so.subtotal) - Number(so.discountAmount));
  const number = await nextNumber("SI", auth.orgId, new Date(so.date).getFullYear());

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: auth.orgId, number, customerId: so.customerId, deliveryNoteId: dn.id, date: new Date(so.date),
        status: "POSTED", subtotal: so.subtotal, taxAmount: so.taxAmount, totalAmount: so.totalAmount,
        paidAmount: "0", balanceDue: so.totalAmount, notes: `فاتورة تسليم ${dn.number}`,
      }).returning({ id: salesInvoices.id });
      await tx.insert(salesInvoiceLines).values(soLines.map((l) => ({
        salesInvoiceId: inv.id, itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice,
        discountAmount: l.discountAmount, taxAmount: l.taxAmount, totalAmount: l.totalAmount,
      })));

      const glLines = [
        { accountId: A["1103"], debit: total, credit: 0, description: `فاتورة ${number}` },
        { accountId: A["4101"], debit: 0, credit: net, description: `إيراد ${number}` },
      ];
      if (tax > 0 && A["2102"]) glLines.push({ accountId: A["2102"], debit: 0, credit: tax, description: `ضريبة ${number}` });
      await postEntry(tx, {
        orgId: auth.orgId, date: new Date(so.date), sourceType: "SALES_INVOICE", sourceId: inv.id,
        description: `فاتورة بيع ${number} (تسليم ${dn.number})`, journalType: "SALES", userId: auth.userId, lines: glLines,
      });
      await tx.update(customers).set({ balance: sql`${customers.balance} + ${total}` }).where(eq(customers.id, so.customerId));
      await tx.update(deliveryNotes).set({ salesInvoiceId: inv.id }).where(eq(deliveryNotes.id, dn.id));
      await tx.update(salesOrders).set({ status: "INVOICED" }).where(eq(salesOrders.id, so.id));
      return inv.id;
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/invoices");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}
