"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, deliveryNotes, salesInvoices, salesInvoiceLines, salesReturns, salesReturnLines, items, itemCodes, stockMovements } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { currentStock } from "@/lib/erp/inventory";
import { returnFromSalesInvoiceAction, createDeliveryReturnAction, confirmSalesReturnAction } from "@/app/actions/erp/sales-returns";

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
      restockFailed: number; // money credited but stock restock failed — needs manual restock
      unmatchedSkus: string[];
    }
  | { ok: false; error: string };

/**
 * Import marketplace customer returns for a platform (generic CSV path). Mirrors
 * the Amazon settlement refund cycle: match each return's external order → its
 * delivery → posted invoice, then post a credit note (money) + restock the item at
 * the delivery's cost. Rows without a posted invoice (e.g. still-draft orders) are
 * reported, not forced. Deduplicated by already-returned quantity per invoice+item.
 */
export async function importPlatformReturnsAction(platformId: string, returnsInput: unknown): Promise<PlatformReturnsResult> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
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

  let created = 0, skippedDuplicate = 0, noOrder = 0, noInvoice = 0, notOnInvoice = 0, unmatchedSku = 0, failed = 0, restockFailed = 0;
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

    // Dedup: skip if this invoice+item was already returned for >= this quantity.
    const [{ q: alreadyReturned }] = await db.select({ q: sql<string>`coalesce(sum(${salesReturnLines.quantity}),0)` })
      .from(salesReturnLines).innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
      .where(and(eq(salesReturns.organizationId, orgId), eq(salesReturns.salesInvoiceId, inv.id), eq(salesReturnLines.itemId, itemId), eq(salesReturns.status, "POSTED")));
    if (Number(alreadyReturned) >= rf.quantity) { skippedDuplicate++; continue; }

    const date = rf.date && !isNaN(new Date(rf.date).getTime()) ? rf.date : undefined;
    const moneyRet = await returnFromSalesInvoiceAction(inv.id, [{ itemId, quantity: rf.quantity, unitPrice: Number(invLine.unitPrice) }], date);
    if (!moneyRet.ok) { failed++; continue; }

    // Restock at the delivery's own cost (mirror the settlement).
    const [outMove] = await db.select({ unitCost: stockMovements.unitCost }).from(stockMovements)
      .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceId, dn.id), eq(stockMovements.itemId, itemId), eq(stockMovements.type, "OUT"))).limit(1);
    const restockCost = outMove ? Number(outMove.unitCost) : (await currentStock(orgId, itemId, dn.warehouseId)).avgCost;
    const stockRet = await createDeliveryReturnAction({ deliveryNoteId: dn.id, date, lines: [{ itemId, quantity: rf.quantity, unitPrice: restockCost }] });
    let restocked = false;
    if (stockRet.ok && stockRet.id) { const conf = await confirmSalesReturnAction(stockRet.id); restocked = !!conf.ok; }
    created++;
    // Money credit posted but the stock restock failed — surface it (don't hide a half-done return).
    if (!restocked) restockFailed++;
  }

  revalidatePath("/erp/sales/returns");
  revalidatePath("/erp/platforms/[code]/import", "page");
  return { ok: true, created, skippedDuplicate, noOrder, noInvoice, notOnInvoice, unmatchedSku, failed, restockFailed, unmatchedSkus: [...unmatchedSkus].slice(0, 30) };
}
