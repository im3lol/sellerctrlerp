"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { round2 } from "@/lib/erp/money";
import { and, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { salesInvoices, salesInvoiceLines, customers, warehouses, deliveryNotes, deliveryNoteLines, salesOrders, salesOrderLines, accountingConfigurations, items } from "@/db/schema";
import { createReceiptVoucherAction } from "@/app/actions/erp/receipts";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry } from "@/lib/erp/posting";
import { postStockMovement } from "@/lib/erp/inventory";
import { recordAudit, tryRecordAudit } from "@/lib/erp/audit";
import { linkDocuments } from "@/lib/erp/links";
import { recomputeSalesOrderStatus } from "@/lib/erp/sales-order";
import { log } from "@/lib/log";

export type SaveInvoiceState = ActionState & { id?: string };

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر"),
  unitPrice: z.coerce.number().min(0),
  discountAmount: z.coerce.number().min(0).default(0),
  taxAmount: z.coerce.number().min(0).default(0),
  /** Ship this line from a specific warehouse. Omitted = the fallback below. */
  warehouseId: z.string().optional(),
});

const schema = z.object({
  customerId: z.string().min(1, "اختر العميل"),
  date: z.string().min(1, "التاريخ مطلوب"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1, "أضف بنداً واحداً على الأقل"),
});
/** Next invoice number SI-YYYY-NNNN for the org (per-year sequence). */
async function nextNumber(orgId: string, year: number): Promise<string> {
  return nextDocumentNumber(db, orgId, "SI", year);
}

export async function createSalesInvoiceAction(input: unknown): Promise<SaveInvoiceState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { customerId, date, notes, lines } = parsed.data;

    // Verify the customer belongs to the active org, and pick up the rep who owns the
    // account — the commission follows them and is frozen on the invoice, so reassigning
    // the customer later cannot restate what somebody already earned.
    const [cust] = await db
      .select({ id: customers.id, salesRepId: customers.salesRepId })
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
            salesRepId: cust?.salesRepId ?? null,
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
            warehouseId: l.warehouseId ?? null,
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
      revalidatePath("/sales/invoices");
      revalidatePath("/sales");
      return { ok: true, id };
    } catch (e) {
      return { error: e instanceof Error && e.message.includes("unique") ? "رقم الفاتورة مستخدم — أعد المحاولة" : "تعذّر حفظ الفاتورة" };
    }
  });
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

  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db
      .select()
      .from(salesInvoices)
      .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId)))
      .limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status !== "DRAFT") return { error: "الفاتورة مُرحّلة بالفعل" };

    const byCode = await resolveAccountIds(auth.orgId, ["1103", "4101", "2102", "5101", "1104"]);
    if (!byCode["1103"] || !byCode["4101"]) {
      return { error: "حسابات الترحيل غير مكتملة (العملاء/المبيعات). أضِفها في دليل الحسابات." };
    }

    const total = Number(inv.totalAmount);
    const tax = Number(inv.taxAmount);
    const shipping = Number(inv.shippingAmount ?? 0);
    const net = Number(inv.subtotal) - Number(inv.discountAmount);
    const fromDelivery = Boolean(inv.deliveryNoteId);

    const lines = [
      { accountId: byCode["1103"], debit: total, credit: 0, description: `فاتورة بيع ${inv.number}` },
      { accountId: byCode["4101"], debit: 0, credit: net, description: `إيراد مبيعات ${inv.number}` },
    ];
    // Shipping billed to the customer is revenue too — without this line the entry
    // wouldn't balance now that totalAmount includes the order's shipping.
    if (shipping > 0) {
      lines.push({ accountId: byCode["4101"], debit: 0, credit: shipping, description: `إيراد شحن ${inv.number}` });
    }
    if (tax > 0 && byCode["2102"]) {
      lines.push({ accountId: byCode["2102"], debit: 0, credit: tax, description: `ضريبة مخرجات ${inv.number}` });
    }

    try {
      const entryId = await db.transaction(async (tx) => {
        // Credit-limit guard UNDER LOCK: posting adds `totalAmount` to the customer's
        // receivable balance — checked outside the tx, two concurrent posts could
        // both pass on the same stale balance and blow past the limit together.
        const [cust] = await tx
          .select({ balance: customers.balance, creditLimit: customers.creditLimit, name: customers.nameAr })
          .from(customers)
          .where(and(eq(customers.id, inv.customerId), eq(customers.organizationId, auth.orgId)))
          .for("update")
          .limit(1);
        const creditLimit = Number(cust?.creditLimit ?? 0);
        if (creditLimit > 0 && Number(cust?.balance ?? 0) + total > creditLimit + 1e-6) {
          throw new Error(`يتجاوز هذا الترحيل حد ائتمان العميل «${cust?.name ?? ""}» (${creditLimit.toLocaleString("ar-EG-u-nu-latn")}).`);
        }
        const eid = await postEntry(tx, {
          orgId: auth.orgId, date: new Date(inv.date), sourceType: "SALES_INVOICE", sourceId: inv.id,
          description: `فاتورة بيع ${inv.number}`, journalType: "SALES", userId: auth.userId, lines,
        });

        if (fromDelivery) {
          // Stock + COGS already posted at the delivery — settle the order, no stock here.
          const [dn] = await tx.select().from(deliveryNotes).where(and(eq(deliveryNotes.id, inv.deliveryNoteId!), eq(deliveryNotes.organizationId, auth.orgId))).limit(1);
          await tx.update(deliveryNotes).set({ salesInvoiceId: inv.id, status: "INVOICED" }).where(and(eq(deliveryNotes.id, inv.deliveryNoteId!), eq(deliveryNotes.organizationId, auth.orgId)));
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
          // Service lines bill revenue and move nothing — an hour of work was never on a
          // shelf, so issuing stock for it would leave the store short of a fiction.
          const invLines = (await tx.select({
            itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity,
            warehouseId: salesInvoiceLines.warehouseId, isService: items.isService,
          })
            .from(salesInvoiceLines)
            .leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
            .where(eq(salesInvoiceLines.salesInvoiceId, inv.id)))
            .filter((l) => !l.isService);
          const [wh] = await tx.select({ id: warehouses.id }).from(warehouses)
            .where(and(eq(warehouses.organizationId, auth.orgId), eq(warehouses.isActive, true))).limit(1);
          // Prefer each line's originating sales-order-line warehouse (an order→invoice
          // that skipped the delivery step still knows where to issue from); only fall
          // back to "first active" for a truly standalone invoice with no order.
          const whByItem = new Map<string, string>();
          if (inv.salesOrderId) {
            const ols = await tx.select({ itemId: salesOrderLines.itemId, warehouseId: salesOrderLines.warehouseId })
              .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, inv.salesOrderId));
            for (const o of ols) if (o.warehouseId) whByItem.set(o.itemId, o.warehouseId);
          }
          // Never book revenue+AR with no COGS/stock movement (mirrors the delivery
          // path, deliveries.ts): if there are goods to issue but no warehouse or the
          // inventory/COGS accounts are missing, refuse instead of posting revenue-only.
          const hasIssuable = invLines.some((l) => Number(l.quantity) > 0);
          if (hasIssuable && !(wh && byCode["5101"] && byCode["1104"])) {
            throw new Error("تعذّر الترحيل — لا يوجد مخزن نشط أو أن حسابَي المخزون (1104) وتكلفة المبيعات (5101) غير مكتملين");
          }
          let cogs = 0;
          if (wh && byCode["5101"] && byCode["1104"]) {
            for (const l of invLines) {
              const qty = Number(l.quantity);
              if (qty <= 0) continue;
              const r = await postStockMovement(tx, {
                orgId: auth.orgId, itemId: l.itemId, warehouseId: l.warehouseId ?? whByItem.get(l.itemId) ?? wh.id, type: "OUT",
                quantity: qty, date: new Date(inv.date), referenceType: "SALES_INVOICE", referenceId: inv.id, reason: `صرف بيع ${inv.number}`,
              });
              // Zero-cost issue on a positive qty means the item has quantity but no
              // inventory value (miscosted / opening-qty-without-value) — it books as
              // pure margin. Surface it for review instead of silently hiding it.
              if (r.totalCost === 0) log.warn("sales_invoice.zero_cost_issue", { orgId: auth.orgId, invoice: inv.number, itemId: l.itemId, qty });
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
      revalidatePath("/sales/invoices");
      revalidatePath("/sales/deliveries");
      revalidatePath("/sales/orders");
      revalidatePath("/accounting/journal");
      return { ok: true, entryId };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الترحيل";
      return { error: msg.includes("unique") || msg.includes("23505") ? "الفاتورة مُرحّلة بالفعل" : msg };
    }
  });
}

/** Delete a DRAFT sales invoice (nothing posted yet). Posted invoices are immutable. */
export async function deleteSalesInvoiceAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [inv] = await db.select().from(salesInvoices)
      .where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
    if (!inv) return { error: "الفاتورة غير موجودة" };
    if (inv.status !== "DRAFT") return { error: "لا يمكن حذف فاتورة مُرحّلة" };
    try {
      await db.transaction(async (tx) => {
        await tx.delete(salesInvoiceLines).where(eq(salesInvoiceLines.salesInvoiceId, inv.id));
        await tx.delete(salesInvoices).where(eq(salesInvoices.id, inv.id));
        // If this draft came from a direct order conversion, reopen the order so it
        // can be re-invoiced instead of being stranded at INVOICED forever (Audit#7).
        if (inv.salesOrderId) {
          await tx.update(salesOrders).set({ status: "CONFIRMED" })
            .where(and(eq(salesOrders.id, inv.salesOrderId), eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.status, "INVOICED")));
        }
        await recordAudit(tx, { orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "SALES_INVOICE", entityId: inv.id, entityNumber: inv.number, summary: `حذف مسودة فاتورة بيع ${inv.number}` });
      });
      revalidatePath("/sales/orders");
      revalidatePath("/sales/invoices");
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحذف" };
    }
  });
}

export type SalesInvoicesFilter = { q?: string; status?: string; customer?: string; from?: string; to?: string };

/** DRAFT invoice ids matching the page filter — bulk ops apply to drafts only, so
 *  "select all across pages" re-derives exactly those on the server. */
async function matchingDraftInvoiceIds(orgId: string, f: SalesInvoicesFilter): Promise<string[]> {
  const conds = [eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "DRAFT")];
  if (f.q) conds.push(ilike(salesInvoices.number, `%${f.q}%`));
  if (f.customer) conds.push(eq(salesInvoices.customerId, f.customer));
  if (f.from) conds.push(gte(salesInvoices.date, new Date(f.from)));
  if (f.to) conds.push(lte(salesInvoices.date, new Date(f.to + "T23:59:59")));
  return (await db.select({ id: salesInvoices.id }).from(salesInvoices).where(and(...conds))).map((r) => r.id);
}

/** Posted invoices with an outstanding balance — the "collect" op re-derives these
 *  server-side for the select-all-across-pages path. */
async function matchingCollectibleInvoiceIds(orgId: string, f: SalesInvoicesFilter): Promise<string[]> {
  const conds = [
    eq(salesInvoices.organizationId, orgId),
    inArray(salesInvoices.status, ["POSTED", "PARTIAL_PAID"]),
    sql`${salesInvoices.balanceDue} > 0`,
  ];
  if (f.q) conds.push(ilike(salesInvoices.number, `%${f.q}%`));
  if (f.customer) conds.push(eq(salesInvoices.customerId, f.customer));
  if (f.from) conds.push(gte(salesInvoices.date, new Date(f.from)));
  if (f.to) conds.push(lte(salesInvoices.date, new Date(f.to + "T23:59:59")));
  return (await db.select({ id: salesInvoices.id }).from(salesInvoices).where(and(...conds))).map((r) => r.id);
}

/**
 * Bulk post / delete sales invoices (drafts only). Skips ineligible rows.
 * `all` re-derives the ids server-side from the current filter so the client never
 * ships thousands of ids. ponytail: loops the guarded per-row action — posting has
 * per-invoice side effects (GL entry, stock, COGS) so it can't be set-based;
 * bounded by the draft count, upgrade to batched posting only if that grows huge.
 */
export async function bulkSalesInvoicesAction(op: "post" | "delete" | "collect", ids: string[], all?: SalesInvoicesFilter): Promise<ActionState & { count?: number }> {
  const perm = op === "delete" ? "sales.create" : op === "collect" ? "sales.collect" : "accounting.post";
  const auth = await authorizeErp(perm);
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    if (all) ids = op === "collect" ? await matchingCollectibleInvoiceIds(auth.orgId, all) : await matchingDraftInvoiceIds(auth.orgId, all);
    if (!ids.length) return { error: "لم تُحدّد أي فواتير" };

    if (op === "collect") {
      // Bulk collect: a DRAFT receipt voucher for each posted invoice's outstanding
      // balance, on the org's default cash account. Reviewed & confirmed later.
      const [cfg] = await db.select({ cashAccountId: accountingConfigurations.cashAccountId })
        .from(accountingConfigurations).where(eq(accountingConfigurations.organizationId, auth.orgId)).limit(1);
      if (!cfg?.cashAccountId) return { error: "لم يُحدّد حساب النقدية الافتراضي في الضبط المحاسبي" };
      const today = new Date().toISOString().slice(0, 10);
      let count = 0;
      let lastError: string | undefined;
      for (const id of ids) {
        const [inv] = await db.select({ customerId: salesInvoices.customerId, balanceDue: salesInvoices.balanceDue, status: salesInvoices.status })
          .from(salesInvoices).where(and(eq(salesInvoices.id, id), eq(salesInvoices.organizationId, auth.orgId))).limit(1);
        if (!inv || (inv.status !== "POSTED" && inv.status !== "PARTIAL_PAID") || Number(inv.balanceDue) <= 0) continue;
        const r = await createReceiptVoucherAction({ customerId: inv.customerId, salesInvoiceId: id, cashAccountId: cfg.cashAccountId, amount: Number(inv.balanceDue), date: today });
        if (r.ok) count++;
        else lastError = r.error;
      }
      if (count === 0) return { error: lastError ?? "لا توجد فواتير قابلة للتحصيل ضمن المحدّد" };
      revalidatePath("/sales/receipts");
      revalidatePath("/sales/invoices");
      return { ok: true, count };
    }

    let count = 0;
    let lastError: string | undefined;
    for (const id of ids) {
      const r = op === "post" ? await postSalesInvoiceAction(id) : await deleteSalesInvoiceAction(id);
      if (r.ok) count++;
      else lastError = r.error;
    }
    if (count === 0) return { error: lastError ?? "تعذّر التنفيذ" };
    return { ok: true, count };
  });
}
