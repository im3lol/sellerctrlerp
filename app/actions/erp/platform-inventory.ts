"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, items, itemCodes, warehouses } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { parseInventoryLedger } from "@/lib/erp/amazon-inventory";
import { currentStock } from "@/lib/erp/inventory";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";

export type InventoryReconRow = { sku: string; title: string; amazonQty: number; itemId: string; itemName: string; erpQty: number; diff: number };
export type InventoryReconResult =
  | { ok: true; totalSkus: number; totalUnits: number; matched: number; unmatched: number; withDiff: number; warehouseName: string; warehouseId: string; rows: InventoryReconRow[]; unmatchedSample: string[] }
  | { ok: false; error: string };

/**
 * Reconcile a platform's warehouse against an Amazon FBA Inventory Ledger file
 * (read-only preview): parse the ledger → ending on-hand per MSKU → match to ERP
 * items → compare with the ERP's current stock in the platform's warehouse.
 */
export async function reconcilePlatformInventoryAction(platformId: string, formData: FormData): Promise<InventoryReconResult> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
  if (!platform) return { ok: false, error: "المنصة غير موجودة" };
  if (!platform.defaultWarehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  const [wh] = await db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
    .where(and(eq(warehouses.id, platform.defaultWarehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
  if (!wh) return { ok: false, error: "مخزن المنصة غير موجود" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ارفع ملف دفتر المخزون أولاً" };

  let summary;
  try { summary = parseInventoryLedger(await file.text()); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" }; }

  // Match SKUs → items (item_codes then item.code, normalized).
  const norms = [...new Set([...summary.perSku.keys()].map(normalizeCode).filter(Boolean))];
  const byNorm = new Map<string, string>();
  for (let i = 0; i < norms.length; i += 800) {
    const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.normalizedCode, norms.slice(i, i + 800))));
    for (const r of rows) if (r.norm) byNorm.set(r.norm, r.itemId);
  }
  const itemRows = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items).where(eq(items.organizationId, auth.orgId));
  const byItemCode = new Map<string, string>(), nameById = new Map<string, string>();
  for (const it of itemRows) { byItemCode.set(normalizeCode(it.code), it.id); nameById.set(it.id, it.nameAr || it.code); }
  const matchItem = (sku: string) => { const n = normalizeCode(sku); return byNorm.get(n) ?? byItemCode.get(n) ?? null; };

  const rows: InventoryReconRow[] = [];
  const unmatchedSample: string[] = [];
  let matched = 0, unmatched = 0;
  for (const [sku, amazonQty] of summary.perSku) {
    const itemId = matchItem(sku);
    if (!itemId) { unmatched++; if (unmatchedSample.length < 40) unmatchedSample.push(sku); continue; }
    matched++;
    const cur = await currentStock(auth.orgId, itemId, wh.id);
    const erpQty = Number(cur.quantity);
    rows.push({ sku, title: summary.titles.get(sku) ?? "", amazonQty, itemId, itemName: nameById.get(itemId) ?? "", erpQty, diff: Math.round((amazonQty - erpQty) * 1000) / 1000 });
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    ok: true, totalSkus: summary.perSku.size, totalUnits: summary.totalUnits,
    matched, unmatched, withDiff: rows.filter((r) => Math.abs(r.diff) > 0.001).length,
    warehouseName: wh.nameAr, warehouseId: wh.id, rows: rows.slice(0, 300), unmatchedSample,
  };
}

/**
 * Apply a reconciliation: create a DRAFT stock adjustment that sets the ERP stock
 * of the given items to their Amazon on-hand, in the platform's warehouse. The
 * user confirms the adjustment (which posts stock + GL) as a separate step.
 */
export async function applyInventoryReconciliationAction(
  platformId: string,
  entries: { itemId: string; amazonQty: number }[],
): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const [platform] = await db.select({ warehouseId: salesPlatforms.defaultWarehouseId }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
  if (!platform?.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  const clean = entries.filter((e) => e.itemId && Number.isFinite(e.amazonQty) && e.amazonQty >= 0);
  if (clean.length === 0) return { ok: false, error: "لا توجد بنود للمطابقة" };
  if (clean.length > 500) return { ok: false, error: "عدد كبير من البنود — طابق حتى 500 صنف في المرة" };

  const r = await createStockAdjustmentAction({
    date: new Date().toISOString().slice(0, 10),
    reason: "مطابقة مخزون أمازون",
    lines: clean.map((e) => ({ itemId: e.itemId, warehouseId: platform.warehouseId!, mode: "set", value: e.amazonQty })),
  });
  if (!r.ok) return { ok: false, error: r.error ?? "تعذّر إنشاء التسوية" };
  return { ok: true, id: r.id };
}
