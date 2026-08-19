"use server";

import { withOrgScope } from "@/lib/db-scope";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { parseInventoryLedger } from "@/lib/erp/amazon-inventory";
import { reconcileInventory, type InventoryReconResult } from "@/lib/erp/marketplace/ingest";
import type { MarketplaceInventory } from "@/lib/erp/marketplace/dto";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";

export type InventoryReconActionResult = ({ ok: true } & InventoryReconResult) | { ok: false; error: string };

/**
 * Reconcile a platform's warehouse against an Amazon FBA Inventory Ledger file
 * (read-only preview). Parses the ledger → neutral MarketplaceInventory[] → the
 * shared reconcileInventory core (matches to items, compares to ERP stock).
 */
export async function reconcilePlatformInventoryAction(platformId: string, formData: FormData): Promise<InventoryReconActionResult> {
  const auth = await authorizeErp("inventory.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  return withOrgScope(auth.orgId, false, async () => {
    const [platform] = await db.select({ id: salesPlatforms.id, defaultWarehouseId: salesPlatforms.defaultWarehouseId }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
    if (!platform) return { ok: false, error: "المنصة غير موجودة" };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ارفع ملف دفتر المخزون أولاً" };

    let inventory: MarketplaceInventory[];
    try {
      const summary = parseInventoryLedger(await file.text());
      inventory = [...summary.perSku].map(([code, onHand]) => ({ code, title: summary.titles.get(code) ?? "", onHand }));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
    }

    const r = await reconcileInventory(auth.orgId, platform, inventory);
    if (!r.ok) return r;
    return { ok: true, ...r.result };
  });
}

/**
 * Apply a reconciliation: create a DRAFT stock adjustment that sets the ERP stock
 * of the given items to their marketplace on-hand, in the platform's warehouse.
 * The user confirms the adjustment (which posts stock + GL) as a separate step.
 */
export async function applyInventoryReconciliationAction(
  platformId: string,
  entries: { itemId: string; qty: number }[],
): Promise<{ ok: true; id?: string; number?: string } | { ok: false; error: string }> {
  const auth = await authorizeErp("inventory.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };

  return withOrgScope(auth.orgId, false, async () => {
    const [platform] = await db.select({ warehouseId: salesPlatforms.defaultWarehouseId }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
    if (!platform?.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };

    // Refuse a blanket "set" into a warehouse another ACTIVE, inventory-syncing platform also
    // uses — setting stock to THIS channel's on-hand would wipe the other channel's stock in
    // the shared warehouse. A deactivated or non-inventory-syncing sibling never runs a `set`,
    // so it must not block a legitimate recon; only a live sharer does.
    const [shared] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
      .where(and(
        eq(salesPlatforms.organizationId, auth.orgId),
        eq(salesPlatforms.defaultWarehouseId, platform.warehouseId),
        ne(salesPlatforms.id, platformId),
        eq(salesPlatforms.isActive, true),
        eq(salesPlatforms.syncInventory, true),
      )).limit(1);
    if (shared) return { ok: false, error: "هذا المخزن مشترك مع منصّة أخرى — تطبيق المطابقة سيضبط المخزون على أرقام هذه القناة ويمحو مخزون القناة الأخرى. خصّص مخزنًا مستقلًا لكل منصة أولًا." };

    const clean = entries.filter((e) => e.itemId && Number.isFinite(e.qty) && e.qty >= 0);
    if (clean.length === 0) return { ok: false, error: "لا توجد بنود للمطابقة" };
    if (clean.length > 500) return { ok: false, error: "عدد كبير من البنود — طابق حتى 500 صنف في المرة" };

    const r = await createStockAdjustmentAction({
      date: new Date().toISOString().slice(0, 10),
      reason: "مطابقة مخزون المنصة",
      lines: clean.map((e) => ({ itemId: e.itemId, warehouseId: platform.warehouseId!, mode: "set", value: e.qty })),
    });
    if (!r.ok) return { ok: false, error: r.error ?? "تعذّر إنشاء التسوية" };
    return { ok: true, id: r.id, number: r.number };
  });
}
