import "server-only";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  platformReturns, marketplaceSettlementTxns, salesOrders, deliveryNotes,
  salesInvoices, salesInvoiceLines, itemCodes, items,
} from "@/db/schema";
import { createSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { returnDedupKey, type FbaReturnRow } from "@/lib/erp/amazon-returns";

// Session-less FBA-returns engine (mirrors settlement-core): upsert the report
// rows idempotently, then turn each unclaimed row into a DRAFT مرتجع فاتورة —
// or link it to the return the settlement-refund cycle already created. The
// caller establishes the org RLS scope; document creation needs an ErpContext.

const CHANNEL = "AMAZON";

/** Idempotent upsert of returns-report rows (no documents). */
export async function upsertPlatformReturns(orgId: string, rows: FbaReturnRow[]): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };
  const values = rows.map((r) => ({
    organizationId: orgId, channel: CHANNEL, orderId: r.orderId, sku: r.sku, asin: r.asin || null,
    returnDate: r.returnDate, quantity: String(r.quantity), disposition: r.disposition || null,
    reason: r.reason || null, status: r.status || null, fulfillmentCenter: r.fulfillmentCenter || null,
    licensePlateNumber: r.licensePlateNumber || null, dedupKey: returnDedupKey(r), raw: r as unknown,
  }));
  // Same-report duplicates would trip ON CONFLICT twice in one statement.
  const byKey = new Map(values.map((v) => [v.dedupKey, v]));
  const merged = [...byKey.values()];
  let imported = 0;
  for (let i = 0; i < merged.length; i += 500) {
    const inserted = await db.insert(platformReturns).values(merged.slice(i, i + 500))
      .onConflictDoNothing({ target: [platformReturns.organizationId, platformReturns.dedupKey] })
      .returning({ id: platformReturns.id });
    imported += inserted.length;
  }
  return { imported, skipped: rows.length - imported };
}

export type ProcessReturnsResult = { created: number; linkedToSettlement: number; unmatched: number };

/**
 * Claim every unclaimed return row: link it to the settlement-refund's return
 * when one exists for the same order+sku (no duplicate), else create a DRAFT
 * مرتجع فاتورة for the operator to review and confirm — never auto-confirmed.
 */
export async function processPlatformReturns(orgId: string): Promise<ProcessReturnsResult> {
  const pending = await db.select({
    id: platformReturns.id, orderId: platformReturns.orderId, sku: platformReturns.sku,
    quantity: platformReturns.quantity, returnDate: platformReturns.returnDate,
  }).from(platformReturns)
    .where(and(eq(platformReturns.organizationId, orgId), isNull(platformReturns.salesReturnId)));
  if (pending.length === 0) return { created: 0, linkedToSettlement: 0, unmatched: 0 };

  // Settlement refunds that already produced a return, keyed by order|normalized sku.
  const refunds = await db.select({
    orderId: marketplaceSettlementTxns.orderId, sku: marketplaceSettlementTxns.sku,
    salesReturnId: marketplaceSettlementTxns.salesReturnId,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.type, "Refund"),
    isNotNull(marketplaceSettlementTxns.salesReturnId),
    inArray(marketplaceSettlementTxns.orderId, [...new Set(pending.map((p) => p.orderId))]),
  ));
  const refundByKey = new Map<string, string>();
  for (const r of refunds) {
    if (r.orderId && r.salesReturnId) refundByKey.set(`${r.orderId}|${normalizeCode(r.sku || "")}`, r.salesReturnId);
  }

  let created = 0, linkedToSettlement = 0, unmatched = 0;
  for (const p of pending) {
    const norm = normalizeCode(p.sku);

    // 1) The settlement-refund cycle already created this return → just link.
    const existing = refundByKey.get(`${p.orderId}|${norm}`);
    if (existing) {
      await db.update(platformReturns).set({ salesReturnId: existing }).where(eq(platformReturns.id, p.id));
      linkedToSettlement++;
      continue;
    }

    // 2) Resolve order → delivery → POSTED invoice → invoice line (same chain as
    //    the settlement refund cycle). Unmatched rows stay unclaimed and retry on
    //    the next run (the order may simply not be invoiced yet).
    const [order] = await db.select({ id: salesOrders.id }).from(salesOrders)
      .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, CHANNEL), eq(salesOrders.externalOrderId, p.orderId))).limit(1);
    if (!order) { unmatched++; continue; }
    const [dn] = await db.select({ id: deliveryNotes.id }).from(deliveryNotes)
      .where(and(eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.salesOrderId, order.id))).orderBy(desc(deliveryNotes.createdAt)).limit(1);
    if (!dn) { unmatched++; continue; }
    const [inv] = await db.select({ id: salesInvoices.id }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.deliveryNoteId, dn.id), eq(salesInvoices.status, "POSTED"))).limit(1);
    if (!inv) { unmatched++; continue; }

    let itemId: string | null = null;
    if (norm) {
      const [code] = await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.normalizedCode, norm))).limit(1);
      itemId = code?.itemId ?? null;
    }
    if (!itemId) {
      const [it] = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, orgId), eq(items.code, p.sku))).limit(1);
      itemId = it?.id ?? null;
    }
    if (!itemId) { unmatched++; continue; }
    const [invLine] = await db.select({ unitPrice: salesInvoiceLines.unitPrice }).from(salesInvoiceLines)
      .where(and(eq(salesInvoiceLines.salesInvoiceId, inv.id), eq(salesInvoiceLines.itemId, itemId))).limit(1);
    if (!invLine) { unmatched++; continue; }

    // 3) DRAFT credit note only — the operator reviews (disposition, restock) and
    //    confirms. ponytail: create → stamp; a crash between the two leaves one
    //    visible, deletable orphan DRAFT — acceptable, no confirm step to resume.
    const qty = Math.abs(Number(p.quantity) || 1);
    const date = (p.returnDate ?? new Date()).toISOString().slice(0, 10);
    const ret = await createSalesReturnAction({
      salesInvoiceId: inv.id, date,
      notes: `مرتجع أمازون FBA — طلب ${p.orderId}`,
      lines: [{ itemId, quantity: qty, unitPrice: Number(invLine.unitPrice) }],
    });
    if (!ret.ok || !ret.id) { unmatched++; continue; }
    await db.update(platformReturns).set({ salesReturnId: ret.id }).where(eq(platformReturns.id, p.id));
    created++;
  }
  return { created, linkedToSettlement, unmatched };
}

/** Count of return rows not yet linked to any مرتجع (for UI badges). */
export async function unclaimedReturnsCount(orgId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(platformReturns)
    .where(and(eq(platformReturns.organizationId, orgId), isNull(platformReturns.salesReturnId)));
  return Number(r?.n ?? 0);
}
