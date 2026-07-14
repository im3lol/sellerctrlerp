import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { ingestOrders, ingestProducts, reconcileInventory, enrichItems, linkVariationFamilies, type PlatformCtx, type ProductSyncMode } from "@/lib/erp/marketplace/ingest";
import type { MarketplaceConnector, Credential } from "@/lib/erp/marketplace/connector";
import type { DateRange } from "@/lib/erp/marketplace/dto";

// Session-less marketplace sync core — shared by the "مزامنة الآن" button actions
// (which add auth on top) and the auto-sync cron (which has no user session).

export type SyncFlags = { products: boolean; orders: boolean; inventory: boolean };
export type SyncPrep = { orgId: string; connector: MarketplaceConnector; cred: Credential; ctx: PlatformCtx; mode: ProductSyncMode; provider: string; flags: SyncFlags };

export type ProductsSync = { ok: true; total: number; linked: number; created: number; alreadyLinked: number; skippedUnmatched: number; images: number; barcodes: number; fields: number; families: number } | { ok: false; error: string };
export type OrdersSync = { ok: true; created: number; fulfilled: number; transitioned: number; skippedDuplicate: number; skippedUnmatched: number; stockBlocked: number } | { ok: false; error: string };
export type InventorySync = { ok: true; matched: number; withDiff: number; unmatched: number } | { ok: false; error: string };

/** Load the connector, decrypted credential, platform ctx and settings — no auth. */
export async function prepareSync(orgId: string, code: string): Promise<SyncPrep | { error: string }> {
  const connector = getConnector(code);
  if (!connector) return { error: "لا يوجد موصّل لهذه المنصة" };
  const provider = connector.code.toLowerCase();

  const [row] = await db.select().from(platformCredentials)
    .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider))).limit(1);
  if (!row) return { error: "المنصة غير مربوطة — اربط الحساب أولًا" };
  const refreshToken = decryptSecret(row.refreshToken);
  if (!refreshToken) return { error: "تعذّر فك تشفير التوكن — أعد ربط الحساب" };
  const cred: Credential = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };

  if (connector.code === "AMAZON") await ensureAmazonPlatform(orgId);
  const [p] = await db.select({ id: salesPlatforms.id, customerId: salesPlatforms.customerId, warehouseId: salesPlatforms.defaultWarehouseId, name: salesPlatforms.name, mode: salesPlatforms.productSyncMode, syncProducts: salesPlatforms.syncProducts, syncOrders: salesPlatforms.syncOrders, syncInventory: salesPlatforms.syncInventory, autoInvoice: salesPlatforms.autoInvoice })
    .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, connector.code))).limit(1);
  if (!p?.customerId) return { error: "المنصة بلا عميل مرتبط" };

  const ctx: PlatformCtx = { platformId: p.id, customerId: p.customerId, warehouseId: p.warehouseId, channel: connector.code, label: p.name, autoInvoice: p.autoInvoice };
  const flags: SyncFlags = { products: p.syncProducts, orders: p.syncOrders, inventory: p.syncInventory };
  return { orgId, connector, cred, ctx, mode: (p.mode as ProductSyncMode) ?? "create", provider, flags };
}

export { incrementalFrom, SYNC_OVERLAP_MS } from "./sync-range";

export async function markSync(orgId: string, provider: string, patch: Partial<{ lastSyncStatus: string; productsSyncedAt: Date }> = {}) {
  await db.update(platformCredentials).set({ lastSyncAt: new Date(), updatedAt: new Date(), ...patch })
    .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider)));
}

/**
 * Products: link/create + catalog enrichment (image/brand/dims/barcodes/families).
 * Pass `since` for an incremental pull (only listings changed since then) — fast,
 * and doesn't re-run the whole catalog; omit it for a full sync/reconciliation.
 */
export async function syncProductsCore(p: SyncPrep, since?: Date): Promise<ProductsSync> {
  if (!p.connector.fetchProducts) return { ok: false, error: "المنصة لا تدعم مزامنة المنتجات" };
  try {
    const products = await p.connector.fetchProducts(p.cred, since);
    const r = await ingestProducts(p.orgId, products, p.mode);

    let images = 0, barcodes = 0, fields = 0, families = 0;
    const fetchCatalog = p.connector.fetchCatalog;
    if (fetchCatalog) {
      const asins = [...new Set(products.map((x) => x.altCode).filter((a): a is string => !!a))];
      if (asins.length) {
        try {
          const records = await fetchCatalog(p.cred, asins);
          const e = await enrichItems(p.orgId, records);
          images = e.images; barcodes = e.barcodes; fields = e.fields;
          const fam = await linkVariationFamilies(p.orgId, records, async (parentAsins) => {
            const precs = await fetchCatalog(p.cred, parentAsins);
            const m = new Map<string, { name?: string; imageUrl?: string }>();
            for (const pr of precs) m.set(pr.asin, { name: pr.name, imageUrl: pr.imageUrl });
            return m;
          });
          families = fam.familiesLinked;
        } catch { /* enrichment is optional */ }
      }
    }
    return { ok: true, ...r, images, barcodes, fields, families };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب المنتجات" };
  }
}

/** Orders: pull the given window and drive the sales-order cycle. userId=null in cron. */
export async function syncOrdersCore(p: SyncPrep, userId: string | null, range: DateRange): Promise<OrdersSync> {
  if (!p.connector.fetchOrders) return { ok: false, error: "المنصة لا تدعم مزامنة الأوامر" };
  try {
    const orders = await p.connector.fetchOrders(p.cred, range);
    const r = await ingestOrders(p.orgId, userId, p.ctx, orders);
    return { ok: true, created: r.created, fulfilled: r.fulfilled, transitioned: r.transitioned, skippedDuplicate: r.skippedDuplicate, skippedUnmatched: r.skippedUnmatched, stockBlocked: r.stockBlocked.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب الأوامر" };
  }
}

/** Inventory: read-only reconciliation (a DRAFT adjustment is confirmed separately). */
export async function syncInventoryCore(p: SyncPrep): Promise<InventorySync> {
  if (!p.connector.fetchInventory || !p.ctx.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  try {
    const inv = await p.connector.fetchInventory(p.cred);
    const rec = await reconcileInventory(p.orgId, { defaultWarehouseId: p.ctx.warehouseId }, inv);
    if (!rec.ok) return { ok: false, error: rec.error };
    return { ok: true, matched: rec.result.matched, withDiff: rec.result.withDiff, unmatched: rec.result.unmatched };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب المخزون" };
  }
}
