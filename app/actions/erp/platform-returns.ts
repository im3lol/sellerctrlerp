"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, deliveryNotes, salesInvoices, salesInvoiceLines, salesReturns, salesReturnLines, items, itemCodes } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { createSalesReturnAction } from "@/app/actions/erp/sales-returns";

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
