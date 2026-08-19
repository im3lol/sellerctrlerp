"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesPlatforms, items, itemCodes, platformRemovals } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";

const rowSchema = z.object({
  sku: z.string().trim().min(1),
  disposed: z.coerce.number().min(0).default(0),  // disposed/destroyed units → inventory loss
  returned: z.coerce.number().min(0).default(0),  // units shipped back to the seller
});

export type PlatformRemovalsResult =
  | {
      ok: true;
      totalDisposed: number; totalReturned: number;
      matchedItems: number; matchedDisposedUnits: number; unmatched: number;
      unmatchedSkus: string[]; adjustmentId?: string; adjustmentNumber?: string;
    }
  | { ok: false; error: string };

/**
 * Import an Amazon Removal Order/Shipment Detail report. Disposed units are a real
 * inventory loss (توالف) → written off via a DRAFT stock adjustment in the platform
 * warehouse (delta −disposed); returned-to-seller units are reported for tracking.
 * Draft so the user reviews before posting (and avoids double-counting a ledger
 * reconciliation). Rows are aggregated per SKU.
 */
export async function importPlatformRemovalsAction(platformId: string, rowsInput: unknown): Promise<PlatformRemovalsResult> {
  const auth = await authorizeErp("inventory.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const orgId = auth.orgId;

    const [platform] = await db.select().from(salesPlatforms)
      .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, orgId))).limit(1);
    if (!platform) return { ok: false, error: "المنصة غير موجودة" };
    if (!platform.defaultWarehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };

    const parsed = z.array(rowSchema).safeParse(rowsInput);
    if (!parsed.success) return { ok: false, error: "بيانات الإزالات غير صالحة" };
    const rows = parsed.data;
    if (rows.length === 0) return { ok: false, error: "لا توجد إزالات في الملف" };

    // Aggregate per SKU.
    const bySku = new Map<string, { disposed: number; returned: number }>();
    for (const r of rows) {
      const cur = bySku.get(r.sku) ?? { disposed: 0, returned: 0 };
      cur.disposed += r.disposed; cur.returned += r.returned;
      bySku.set(r.sku, cur);
    }
    const totalDisposed = [...bySku.values()].reduce((s, v) => s + v.disposed, 0);
    const totalReturned = [...bySku.values()].reduce((s, v) => s + v.returned, 0);

    // Match SKUs → items.
    const norms = [...new Set([...bySku.keys()].map(normalizeCode).filter(Boolean))];
    const byNorm = new Map<string, string>();
    for (let i = 0; i < norms.length; i += 800) {
      const cr = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, norms.slice(i, i + 800))));
      for (const r of cr) if (r.norm) byNorm.set(r.norm, r.itemId);
    }
    const itemRows = await db.select({ id: items.id, code: items.code }).from(items).where(eq(items.organizationId, orgId));
    const byItemCode = new Map<string, string>();
    for (const it of itemRows) byItemCode.set(normalizeCode(it.code), it.id);
    const matchItem = (sku: string) => { const n = normalizeCode(sku); return byNorm.get(n) ?? byItemCode.get(n) ?? null; };

    // Write off disposed units (matched only) via a draft adjustment.
    const lines: { itemId: string; warehouseId: string; mode: "delta"; value: number }[] = [];
    const unmatchedSkus = new Set<string>();
    let matchedItems = 0, matchedDisposedUnits = 0, unmatched = 0;
    for (const [sku, v] of bySku) {
      const itemId = matchItem(sku);
      if (!itemId) { unmatched++; unmatchedSkus.add(sku); continue; }
      matchedItems++;
      if (v.disposed > 0) {
        lines.push({ itemId, warehouseId: platform.defaultWarehouseId!, mode: "delta", value: -v.disposed });
        matchedDisposedUnits += v.disposed;
      }
    }

    let adjustmentId: string | undefined;
    let adjustmentNumber: string | undefined;
    if (lines.length > 0) {
      const r = await createStockAdjustmentAction({
        date: new Date().toISOString().slice(0, 10),
        reason: `إزالة/إتلاف ${platform.name}`,
        lines,
      });
      if (!r.ok) return { ok: false, error: r.error ?? "تعذّر إنشاء تسوية الإتلاف" };
      adjustmentId = r.id;
      adjustmentNumber = r.number;
    }

    return {
      ok: true, totalDisposed, totalReturned, matchedItems, matchedDisposedUnits, unmatched,
      unmatchedSkus: [...unmatchedSkus].slice(0, 30), adjustmentId, adjustmentNumber,
    };
  });
}

// ── R2: confirm a synced removal order with the trader's outcome ─────────────
// A removal takes stock OUT of the platform warehouse; the trader decides what happened:
//   RECEIVED → the units shipped back arrived → restock them (delta +shipped).
//   DISPOSED → Amazon destroyed them → write off the loss (delta −disposed).
//   IGNORE   → nothing to book (e.g. cancelled).
// Both post via a DRAFT تسوية مخزون the accountant reviews + posts (surplus 4201 / loss 5301),
// so a returned removal isn't silently booked as income before review.
export const REMOVAL_OUTCOMES = ["RECEIVED", "DISPOSED", "IGNORE"] as const;
export type RemovalOutcome = (typeof REMOVAL_OUTCOMES)[number];

export async function confirmRemovalAction(removalId: string, outcome: RemovalOutcome): Promise<ActionState> {
  const auth = await authorizeErp("inventory.create", "marketplace");
  if ("error" in auth) return auth;
  if (!REMOVAL_OUTCOMES.includes(outcome)) return { error: "قرار غير صالح" };

  return withOrgScope(auth.orgId, false, async () => {
    const [rm] = await db.select().from(platformRemovals)
      .where(and(eq(platformRemovals.id, removalId), eq(platformRemovals.organizationId, auth.orgId))).limit(1);
    if (!rm) return { error: "أمر السحب غير موجود" };
    if (rm.status !== "PENDING") return { error: "تمّت معالجته بالفعل" };

    if (outcome === "IGNORE") {
      await db.update(platformRemovals).set({ status: "IGNORED", updatedAt: new Date() }).where(eq(platformRemovals.id, removalId));
      revalidatePath("/sales/marketplace-removals");
      return { ok: true };
    }

    const qty = outcome === "RECEIVED" ? Number(rm.shippedQty) : Number(rm.disposedQty);
    if (qty <= 0) return { error: outcome === "RECEIVED" ? "لا توجد وحدات راجعة في أمر السحب" : "لا توجد وحدات متلَفة في أمر السحب" };

    // Resolve the SKU → item (unique code, then item.code fallback).
    const norm = normalizeCode(rm.sku);
    let itemId: string | null = null;
    if (norm) {
      const [c] = await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, auth.orgId), eq(itemCodes.normalizedCode, norm))).limit(1);
      itemId = c?.itemId ?? null;
    }
    if (!itemId) {
      const [it] = await db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, auth.orgId), eq(items.code, rm.sku))).limit(1);
      itemId = it?.id ?? null;
    }
    if (!itemId) return { error: `صنف غير معروف (${rm.sku}) — اربط الكود بصنف أولًا` };

    const [plat] = await db.select({ wh: salesPlatforms.defaultWarehouseId }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, auth.orgId), eq(salesPlatforms.code, rm.channel))).limit(1);
    if (!plat?.wh) return { error: "لا يوجد مخزن افتراضي للمنصة" };

    const date = new Date().toISOString().slice(0, 10);
    const delta = outcome === "RECEIVED" ? qty : -qty;
    const reason = outcome === "RECEIVED"
      ? `أمر سحب ${rm.removalOrderId} — استلام مرتجع للمخزن`
      : `أمر سحب ${rm.removalOrderId} — إتلاف مخزون`;
    const adj = await createStockAdjustmentAction({ date, reason, lines: [{ itemId, warehouseId: plat.wh, mode: "delta", value: delta }] });
    if ("error" in adj) return { error: adj.error };

    await db.update(platformRemovals).set({
      status: outcome === "RECEIVED" ? "RESTOCKED" : "DISPOSED",
      stockAdjustmentId: adj.id ?? null, updatedAt: new Date(),
    }).where(eq(platformRemovals.id, removalId));
    revalidatePath("/sales/marketplace-removals");
    return { ok: true };
  });
}
