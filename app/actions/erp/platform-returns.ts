"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, deliveryNotes, salesInvoices, salesInvoiceLines, salesReturns, salesReturnLines, items, itemCodes, platformReturns, customers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { createSalesReturnAction, confirmSalesReturnAction, createDeliveryReturnAction } from "@/app/actions/erp/sales-returns";
import { planReceipt, RETURN_RECEIPTS, type ReturnReceipt } from "@/lib/erp/return-disposition";

const returnSchema = z.object({
  externalOrderId: z.string().trim().min(1),
  sku: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  date: z.string().optional(),
});

export type PlatformReturnsResult =
  | {
      ok: true;
      created: number;
      skippedDuplicate: number;
      // reasons a row couldn't be turned into a return, with a small sample each
      noOrder: number; noInvoice: number; notOnInvoice: number; unmatchedSku: number; failed: number;
      unmatchedSkus: string[];
    }
  | { ok: false; error: string };

/**
 * Import marketplace customer returns for a platform (generic CSV path). Matches each
 * return's external order → its delivery → posted invoice, then creates a DRAFT credit
 * note for the operator to review and confirm from the returns register — same DRAFT-first
 * model as the FBA returns sync (no immediate posting, no auto-restock). The operator picks
 * the disposition (sellable / damaged→write-off / damaged→warehouse) at confirm. Rows
 * without a posted invoice are reported, not forced. Deduped by already-returned qty
 * (DRAFT or POSTED) per invoice+item, so a re-import doesn't duplicate drafts.
 */
export async function importPlatformReturnsAction(platformId: string, returnsInput: unknown): Promise<PlatformReturnsResult> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const orgId = auth.orgId;

    const [platform] = await db.select().from(salesPlatforms)
      .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, orgId))).limit(1);
    if (!platform) return { ok: false, error: "المنصة غير موجودة" };
    if (!platform.isActive) return { ok: false, error: "المنصة موقوفة" };

    const parsed = z.array(returnSchema).safeParse(returnsInput);
    if (!parsed.success) return { ok: false, error: "بيانات المرتجعات غير صالحة" };
    const returns = parsed.data;
    if (returns.length === 0) return { ok: false, error: "لا توجد مرتجعات في الملف" };

    // SKU → item matcher.
    const norms = [...new Set(returns.map((r) => normalizeCode(r.sku)).filter(Boolean))];
    const byNorm = new Map<string, string>();
    for (let i = 0; i < norms.length; i += 800) {
      const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, norms.slice(i, i + 800))));
      for (const r of rows) if (r.norm) byNorm.set(r.norm, r.itemId);
    }
    const itemRows = await db.select({ id: items.id, code: items.code }).from(items).where(eq(items.organizationId, orgId));
    const byItemCode = new Map<string, string>();
    for (const it of itemRows) byItemCode.set(normalizeCode(it.code), it.id);
    const matchItem = (sku: string) => { const n = normalizeCode(sku); return byNorm.get(n) ?? byItemCode.get(n) ?? null; };

    let created = 0, skippedDuplicate = 0, noOrder = 0, noInvoice = 0, notOnInvoice = 0, unmatchedSku = 0, failed = 0;
    const unmatchedSkus = new Set<string>();

    for (const rf of returns) {
      const itemId = matchItem(rf.sku);
      if (!itemId) { unmatchedSku++; unmatchedSkus.add(rf.sku); continue; }

      const [order] = await db.select({ id: salesOrders.id }).from(salesOrders)
        .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, platform.code), eq(salesOrders.externalOrderId, rf.externalOrderId))).limit(1);
      if (!order) { noOrder++; continue; }
      const [dn] = await db.select({ id: deliveryNotes.id, warehouseId: deliveryNotes.warehouseId }).from(deliveryNotes)
        .where(and(eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.salesOrderId, order.id))).orderBy(desc(deliveryNotes.createdAt)).limit(1);
      if (!dn) { noInvoice++; continue; }
      const [inv] = await db.select({ id: salesInvoices.id }).from(salesInvoices)
        .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.deliveryNoteId, dn.id), eq(salesInvoices.status, "POSTED"))).limit(1);
      if (!inv) { noInvoice++; continue; }

      const [invLine] = await db.select({ unitPrice: salesInvoiceLines.unitPrice }).from(salesInvoiceLines)
        .where(and(eq(salesInvoiceLines.salesInvoiceId, inv.id), eq(salesInvoiceLines.itemId, itemId))).limit(1);
      if (!invLine) { notOnInvoice++; continue; }

      // Dedup: skip if this invoice+item already has returns (DRAFT or POSTED) for >= this
      // quantity — so re-importing the same file doesn't pile up duplicate drafts.
      const [{ q: alreadyReturned }] = await db.select({ q: sql<string>`coalesce(sum(${salesReturnLines.quantity}),0)` })
        .from(salesReturnLines).innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
        .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.salesInvoiceId, inv.id), eq(salesReturnLines.itemId, itemId), ne(salesReturns.status, "CANCELLED")));
      if (Number(alreadyReturned) >= rf.quantity) { skippedDuplicate++; continue; }

      // DRAFT credit note only — mirror the FBA path. The operator reviews + confirms it
      // (with a disposition) from the returns register; nothing is posted or restocked here.
      const date = rf.date && !isNaN(new Date(rf.date).getTime()) ? rf.date : new Date().toISOString().slice(0, 10);
      const ret = await createSalesReturnAction({
        salesInvoiceId: inv.id, date,
        notes: `مرتجع ${platform.name} — طلب ${rf.externalOrderId}`,
        channel: platform.code, externalReturnId: rf.externalOrderId,
        lines: [{ itemId, quantity: rf.quantity, unitPrice: Number(invLine.unitPrice) }],
      });
      if (!ret.ok) { failed++; continue; }
      created++;
    }

    revalidatePath("/sales/returns");
    revalidatePath("/platforms/[code]/import", "page");
    return { ok: true, created, skippedDuplicate, noOrder, noInvoice, notOnInvoice, unmatchedSku, failed, unmatchedSkus: [...unmatchedSkus].slice(0, 30) };
  });
}

// ── R1: confirm a platform customer return with a RECEIPT gate ──────────────
/**
 * Confirm a platform customer return (its money-side DRAFT credit note) with a receipt
 * decision. Reuses the proven money+stock split: confirm the credit note, then — only when
 * the trader received the goods — create + confirm a delivery return that restocks at the
 * delivery's own cost (sellable → back to stock; damaged → write-off, no sellable restock).
 * Links stay intact: the credit note carries salesInvoiceId + salesOrderId; the delivery
 * return carries deliveryNoteId + salesOrderId and drops deliveredQty. Idempotent-ish: a
 * money return already POSTED is left alone; a linked platform_returns row is stamped.
 */
export async function confirmPlatformReturnAction(salesReturnId: string, receipt: ReturnReceipt): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm", "marketplace");
  if ("error" in auth) return auth;
  if (!RETURN_RECEIPTS.includes(receipt)) return { error: "قرار استلام غير صالح" };
  const plan = planReceipt(receipt);

  return withOrgScope(auth.orgId, false, async () => {
    const [money] = await db.select().from(salesReturns)
      .where(and(eq(salesReturns.id, salesReturnId), eq(salesReturns.organizationId, auth.orgId))).limit(1);
    if (!money) return { error: "المرتجع غير موجود" };
    if (money.deliveryNoteId) return { error: "ده مرتجع مخزون — أكّده من سجل المرتجعات" };

    // 1) money credit note (reverse revenue/VAT/AR) — skip if already posted. viaPlatform tells
    // confirmSalesReturnAction we own the restock (step 2), bypassing its marketplace-return guard.
    if (money.status === "DRAFT") {
      const r = await confirmSalesReturnAction(salesReturnId, { disposition: plan.disposition, viaPlatform: true });
      if ("error" in r) return r;
    }

    // 2) restock only when actually received, via a delivery return off the original delivery.
    // If restock is required but CANNOT be done, surface an error — never fall through and
    // stamp RECEIVED, which would leave the invoice reversed but the goods lost from the books.
    // The money credit note stays posted; a retry (money already POSTED → step 1 skips) finishes
    // the stock side once the cause is fixed, then stamps below.
    if (plan.restock && money.salesOrderId) {
      const [dn] = await db.select({ id: deliveryNotes.id }).from(deliveryNotes)
        .where(and(eq(deliveryNotes.organizationId, auth.orgId), eq(deliveryNotes.salesOrderId, money.salesOrderId)))
        .orderBy(desc(deliveryNotes.createdAt)).limit(1);
      const rLines = await db.select({ itemId: salesReturnLines.itemId, quantity: salesReturnLines.quantity })
        .from(salesReturnLines).where(eq(salesReturnLines.salesReturnId, salesReturnId));
      if (!dn || !rLines.length) return { error: "تمّ عكس الفاتورة، لكن تعذّر إرجاع المخزون: لا يوجد إذن تسليم مرتبط بالأمر — أرجِع المخزون يدويًا ثم أعد المحاولة." };
      const date = new Date().toISOString().slice(0, 10);
      // unitPrice 0: the delivery-return confirm recomputes real restock cost server-side.
      const created = await createDeliveryReturnAction({ deliveryNoteId: dn.id, date, lines: rLines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitPrice: 0 })) });
      if (!created.ok || !created.id) return { error: `تمّ عكس الفاتورة، لكن تعذّر إرجاع المخزون: ${("error" in created && created.error) || "فشل إنشاء إرجاع التسليم"}` };
      const c = await confirmSalesReturnAction(created.id, { disposition: plan.disposition });
      if ("error" in c) return { error: `تمّ عكس الفاتورة، لكن تعذّر إرجاع المخزون: ${c.error}` };
    }

    // Stamp the linked platform_returns row (if this return came from the sync) so R3 can
    // match a NOT_RECEIVED loss to its reimbursement.
    await db.update(platformReturns).set({ status: plan.status })
      .where(and(eq(platformReturns.organizationId, auth.orgId), eq(platformReturns.salesReturnId, salesReturnId)));

    revalidatePath("/sales/marketplace-returns");
    revalidatePath("/sales/returns");
    return { ok: true };
  });
}

export type MarketplaceReturnRow = {
  id: string; number: string; date: string; channel: string | null; externalReturnId: string | null;
  customerName: string | null; invoiceNumber: string | null; total: number;
  disposition: string | null; itemsSummary: string;
};

/** The platform customer returns awaiting the trader's receipt decision — DRAFT credit notes
 *  tagged with a channel (from the FBA sync or the CSV import). */
export async function getMarketplaceReturns(): Promise<MarketplaceReturnRow[]> {
  const auth = await authorizeErp("sales.view", "marketplace");
  if ("error" in auth) return [];
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      id: salesReturns.id, number: salesReturns.number, date: salesReturns.date,
      channel: salesReturns.channel, externalReturnId: salesReturns.externalReturnId,
      total: salesReturns.totalAmount, disposition: salesReturns.disposition,
      customerName: customers.nameAr, invoiceNumber: salesInvoices.number,
    }).from(salesReturns)
      .leftJoin(customers, eq(customers.id, salesReturns.customerId))
      .leftJoin(salesInvoices, eq(salesInvoices.id, salesReturns.salesInvoiceId))
      .where(and(
        eq(salesReturns.organizationId, auth.orgId),
        eq(salesReturns.status, "DRAFT"),
        sql`${salesReturns.channel} is not null`,
        sql`${salesReturns.salesInvoiceId} is not null`, // money-side returns only
      ))
      .orderBy(desc(salesReturns.date))
      .limit(200);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const lines = await db.select({ rid: salesReturnLines.salesReturnId, qty: salesReturnLines.quantity, name: items.nameAr, code: items.code })
      .from(salesReturnLines).leftJoin(items, eq(items.id, salesReturnLines.itemId))
      .where(inArray(salesReturnLines.salesReturnId, ids));
    const byRet = new Map<string, string[]>();
    for (const l of lines) {
      const label = `${l.name ?? l.code ?? "صنف"} ×${Number(l.qty)}`;
      (byRet.get(l.rid) ?? byRet.set(l.rid, []).get(l.rid)!).push(label);
    }
    return rows.map((r) => ({
      id: r.id, number: r.number, date: new Date(r.date).toISOString(), channel: r.channel,
      externalReturnId: r.externalReturnId, customerName: r.customerName, invoiceNumber: r.invoiceNumber,
      total: Number(r.total), disposition: r.disposition, itemsSummary: (byRet.get(r.id) ?? []).join("، "),
    }));
  });
}
