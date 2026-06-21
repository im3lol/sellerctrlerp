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
import { recordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";

const round2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

async function nextNumber(prefix: string, orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, prefix, year);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recompute a sales order's status from its lines' delivered/invoiced quantities. */
async function recomputeSalesOrderStatus(tx: Tx, soId: string) {
  const lines = await tx.select({ q: salesOrderLines.quantity, d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
  const allDelivered = lines.every((l) => Number(l.d) >= Number(l.q) - EPS);
  const anyDelivered = lines.some((l) => Number(l.d) > EPS);
  const allInvoiced = lines.every((l) => Number(l.inv) >= Number(l.q) - EPS);
  const status = allInvoiced ? "INVOICED" : allDelivered ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : "CONFIRMED";
  await tx.update(salesOrders).set({ status }).where(eq(salesOrders.id, soId));
  return status;
}

export type Pick = { itemId: string; quantity: number };

/**
 * Deliver a confirmed sales order — fully or PARTIALLY. `picks` caps the
 * quantity per item (≤ remaining = ordered − already delivered); omitted →
 * deliver all remaining. Issues stock at WAC + posts COGS, bumps deliveredQty,
 * and recomputes the order status (CONFIRMED → PARTIALLY_DELIVERED → DELIVERED).
 */
export async function createDeliveryFromOrderAction(salesOrderId: string, picks?: Pick[]): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const [so] = await db.select().from(salesOrders)
    .where(and(eq(salesOrders.id, salesOrderId), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return { error: "الأمر غير موجود" };
  if (so.status !== "CONFIRMED" && so.status !== "PARTIALLY_DELIVERED") return { error: "يمكن التسليم من أمر مؤكّد أو منفّذ جزئياً فقط" };

  const orderLines = await db.select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId, quantity: salesOrderLines.quantity, deliveredQty: salesOrderLines.deliveredQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));

  // Resolve quantities to deliver now (default = full remaining), validated ≤ remaining.
  const pickBy = new Map((picks ?? []).map((p) => [p.itemId, p.quantity]));
  const toDeliver: { line: typeof orderLines[number]; qty: number }[] = [];
  for (const l of orderLines) {
    const remaining = round2(Number(l.quantity) - Number(l.deliveredQty));
    const want = picks ? (pickBy.get(l.itemId) ?? 0) : remaining;
    if (want < -EPS) return { error: "كمية غير صالحة" };
    if (want > remaining + EPS) return { error: `الكمية المسلّمة أكبر من المتبقّي للصنف` };
    if (want > EPS) toDeliver.push({ line: l, qty: round2(want) });
  }
  if (toDeliver.length === 0) return { error: "لا توجد كميات للتسليم" };

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
      await tx.insert(deliveryNoteLines).values(toDeliver.map((t) => ({ deliveryNoteId: dn.id, itemId: t.line.itemId, quantity: String(t.qty) })));

      let cogs = 0;
      for (const t of toDeliver) {
        const r = await postStockMovement(tx, {
          orgId: auth.orgId, itemId: t.line.itemId, warehouseId: wh.id, type: "OUT",
          quantity: t.qty, date: new Date(so.date),
          referenceType: "DELIVERY", referenceId: dn.id, reason: `تسليم ${number}`,
        });
        cogs += r.totalCost;
        await tx.update(salesOrderLines).set({ deliveredQty: sql`${salesOrderLines.deliveredQty} + ${t.qty}` }).where(eq(salesOrderLines.id, t.line.id));
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
      const newStatus = await recomputeSalesOrderStatus(tx, so.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "SALES_ORDER", fromId: so.id, fromNumber: so.number, toType: "DELIVERY_NOTE", toId: dn.id, toNumber: number, relation: "FULFILLS" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "DELIVERY_NOTE", entityId: dn.id, entityNumber: number, summary: `تسليم ${number} من أمر بيع ${so.number} (${newStatus === "DELIVERED" ? "كامل" : "جزئي"})`, metadata: { cogs } });
      return dn.id;
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/orders");
    return { ok: true, id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء التسليم" };
  }
}

/**
 * Bill a delivery: POSTED sales invoice for THIS delivery's quantities only
 * (revenue/AR; stock + COGS already posted at delivery). Amounts pro-rate the
 * order line's discount/tax by delivered fraction. Bumps invoicedQty + status.
 */
export async function convertDeliveryToInvoiceAction(deliveryId: string): Promise<ActionState & { invoiceId?: string }> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;

  const [dn] = await db.select().from(deliveryNotes)
    .where(and(eq(deliveryNotes.id, deliveryId), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
  if (!dn) return { error: "التسليم غير موجود" };
  if (dn.salesInvoiceId) return { error: "التسليم مفوتر بالفعل" };
  if (!dn.salesOrderId) return { error: "التسليم غير مرتبط بأمر بيع" };

  const [so] = await db.select().from(salesOrders).where(eq(salesOrders.id, dn.salesOrderId)).limit(1);
  if (!so) return { error: "أمر البيع غير موجود" };
  const soLines = await db.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, so.id));
  const soByItem = new Map(soLines.map((l) => [l.itemId, l]));
  const dnLines = await db.select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity })
    .from(deliveryNoteLines).where(eq(deliveryNoteLines.deliveryNoteId, dn.id));

  const accs = await db.select({ code: accounts.code, id: accounts.id }).from(accounts)
    .where(and(eq(accounts.organizationId, auth.orgId), inArray(accounts.code, ["1103", "4101", "2102"])));
  const A = Object.fromEntries(accs.map((a) => [a.code, a.id]));
  if (!A["1103"] || !A["4101"]) return { error: "حسابات الترحيل غير مكتملة" };

  // Build invoice lines from the delivered quantities, pro-rating discount/tax.
  const invLines: { itemId: string; quantity: string; unitPrice: string; discountAmount: string; taxAmount: string; totalAmount: string }[] = [];
  let subtotal = 0, discount = 0, tax = 0;
  for (const dl of dnLines) {
    const so2 = soByItem.get(dl.itemId);
    if (!so2) continue;
    const dq = Number(dl.quantity);
    const oq = Number(so2.quantity) || dq;
    const f = oq > 0 ? dq / oq : 0;
    const price = Number(so2.unitPrice);
    const lineDisc = round2(Number(so2.discountAmount) * f);
    const lineTax = round2(Number(so2.taxAmount) * f);
    const lineTotal = round2(price * dq - lineDisc + lineTax);
    subtotal += price * dq; discount += lineDisc; tax += lineTax;
    invLines.push({ itemId: dl.itemId, quantity: String(dq), unitPrice: String(price), discountAmount: String(lineDisc), taxAmount: String(lineTax), totalAmount: String(lineTotal) });
  }
  subtotal = round2(subtotal); discount = round2(discount); tax = round2(tax);
  const net = round2(subtotal - discount);
  const total = round2(net + tax);
  if (total <= 0) return { error: "لا توجد كميات قابلة للفوترة" };
  const number = await nextNumber("SI", auth.orgId, new Date(so.date).getFullYear());

  try {
    const invoiceId = await db.transaction(async (tx) => {
      const [inv] = await tx.insert(salesInvoices).values({
        organizationId: auth.orgId, number, customerId: so.customerId, deliveryNoteId: dn.id, date: new Date(so.date),
        status: "POSTED", subtotal: String(subtotal), discountAmount: String(discount), taxAmount: String(tax), totalAmount: String(total),
        paidAmount: "0", balanceDue: String(total), notes: `فاتورة تسليم ${dn.number}`,
      }).returning({ id: salesInvoices.id });
      await tx.insert(salesInvoiceLines).values(invLines.map((l) => ({ salesInvoiceId: inv.id, ...l })));

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
      await tx.update(deliveryNotes).set({ salesInvoiceId: inv.id, status: "INVOICED" }).where(eq(deliveryNotes.id, dn.id));
      for (const dl of dnLines) {
        const so2 = soByItem.get(dl.itemId);
        if (so2) await tx.update(salesOrderLines).set({ invoicedQty: sql`${salesOrderLines.invoicedQty} + ${Number(dl.quantity)}` }).where(eq(salesOrderLines.id, so2.id));
      }
      await recomputeSalesOrderStatus(tx, so.id);
      await linkDocuments(tx, { orgId: auth.orgId, fromType: "DELIVERY_NOTE", fromId: dn.id, fromNumber: dn.number, toType: "SALES_INVOICE", toId: inv.id, toNumber: number, relation: "INVOICES" });
      await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "POST", entityType: "SALES_INVOICE", entityId: inv.id, entityNumber: number, summary: `فاتورة بيع ${number} من إذن صرف ${dn.number}`, metadata: { total } });
      return inv.id;
    });
    revalidatePath("/erp/sales/deliveries");
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/sales/orders");
    return { ok: true, invoiceId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر إنشاء الفاتورة" };
  }
}
