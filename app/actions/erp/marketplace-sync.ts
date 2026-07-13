"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { decryptSecret } from "@/lib/crypto";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { ingestOrders, ingestProducts, reconcileInventory, enrichItems, linkVariationFamilies, type PlatformCtx, type ProductSyncMode } from "@/lib/erp/marketplace/ingest";
import type { MarketplaceConnector, Credential } from "@/lib/erp/marketplace/connector";

const DEFAULT_LOOKBACK_DAYS = 30;

type Flags = { products: boolean; orders: boolean; inventory: boolean };
type Prepared = { orgId: string; userId: string; connector: MarketplaceConnector; cred: Credential; ctx: PlatformCtx; mode: ProductSyncMode; provider: string; flags: Flags };

/** Authorize + load the connector, decrypted credential, platform ctx and settings. */
async function prepare(code: string): Promise<Prepared | { error: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { error: auth.error };

  const connector = getConnector(code);
  if (!connector) return { error: "لا يوجد موصّل لهذه المنصة" };
  const provider = connector.code.toLowerCase();

  const [row] = await db.select().from(platformCredentials)
    .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider))).limit(1);
  if (!row) return { error: "المنصة غير مربوطة — اربط الحساب أولًا" };
  const refreshToken = decryptSecret(row.refreshToken);
  if (!refreshToken) return { error: "تعذّر فك تشفير التوكن — أعد ربط الحساب" };
  const cred: Credential = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };

  // Ensure the platform exists (Amazon), then read its settings row.
  if (connector.code === "AMAZON") await ensureAmazonPlatform(auth.orgId);
  const [p] = await db.select({ id: salesPlatforms.id, customerId: salesPlatforms.customerId, warehouseId: salesPlatforms.defaultWarehouseId, name: salesPlatforms.name, mode: salesPlatforms.productSyncMode, syncProducts: salesPlatforms.syncProducts, syncOrders: salesPlatforms.syncOrders, syncInventory: salesPlatforms.syncInventory })
    .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, auth.orgId), eq(salesPlatforms.code, connector.code))).limit(1);
  if (!p?.customerId) return { error: "المنصة بلا عميل مرتبط" };

  const ctx: PlatformCtx = { platformId: p.id, customerId: p.customerId, warehouseId: p.warehouseId, channel: connector.code, label: p.name };
  const flags: Flags = { products: p.syncProducts, orders: p.syncOrders, inventory: p.syncInventory };
  return { orgId: auth.orgId, userId: auth.userId, connector, cred, ctx, mode: (p.mode as ProductSyncMode) ?? "create", provider, flags };
}

async function markSync(orgId: string, provider: string, status: string) {
  await db.update(platformCredentials).set({ lastSyncAt: new Date(), lastSyncStatus: status, updatedAt: new Date() })
    .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider)));
}

export type ProductsSync = { ok: true; total: number; linked: number; created: number; alreadyLinked: number; skippedUnmatched: number; images: number; barcodes: number; fields: number; families: number } | { ok: false; error: string };
export type OrdersSync = { ok: true; created: number; fulfilled: number; transitioned: number; skippedDuplicate: number; skippedUnmatched: number; stockBlocked: number } | { ok: false; error: string };
export type InventorySync = { ok: true; matched: number; withDiff: number; unmatched: number } | { ok: false; error: string };

/** Step 1 — sync the product catalog (link existing + create new per platform setting). */
export async function syncProductsAction(code: string): Promise<ProductsSync> {
  const p = await prepare(code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.products) return { ok: false, error: "مزامنة المنتجات موقوفة لهذه المنصّة" };
  if (!p.connector.fetchProducts) return { ok: false, error: "المنصة لا تدعم مزامنة المنتجات" };
  try {
    const products = await p.connector.fetchProducts(p.cred);
    const r = await ingestProducts(p.orgId, products, p.mode);

    // Enrich from the catalog (best-effort; each field only filled when empty):
    // image, brand, weight, dimensions, barcodes (UPC/EAN), and variation families.
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

    revalidatePath("/erp/inventory/items");
    return { ok: true, ...r, images, barcodes, fields, families };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب المنتجات" };
  }
}

/** Step 2 — sync orders (last 30 days) through the sales-order cycle. */
export async function syncOrdersAction(code: string): Promise<OrdersSync> {
  const p = await prepare(code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.orders) return { ok: false, error: "مزامنة المبيعات موقوفة لهذه المنصّة" };
  if (!p.connector.fetchOrders) return { ok: false, error: "المنصة لا تدعم مزامنة الأوامر" };
  try {
    const to = new Date();
    const from = new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const orders = await p.connector.fetchOrders(p.cred, { from, to });
    const r = await ingestOrders(p.orgId, p.userId, p.ctx, orders);
    revalidatePath("/erp/sales/orders");
    return { ok: true, created: r.created, fulfilled: r.fulfilled, transitioned: r.transitioned, skippedDuplicate: r.skippedDuplicate, skippedUnmatched: r.skippedUnmatched, stockBlocked: r.stockBlocked.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب الأوامر" };
  }
}

/** Step 3 — reconcile inventory (read-only preview; a DRAFT adjustment is confirmed separately). */
export async function syncInventoryAction(code: string): Promise<InventorySync> {
  const p = await prepare(code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.inventory) return { ok: false, error: "مزامنة المخزون موقوفة لهذه المنصّة" };
  if (!p.connector.fetchInventory || !p.ctx.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  try {
    const inv = await p.connector.fetchInventory(p.cred);
    const rec = await reconcileInventory(p.orgId, { defaultWarehouseId: p.ctx.warehouseId }, inv);
    await markSync(p.orgId, p.provider, "ok");
    revalidatePath(`/erp/platforms/${p.provider}`);
    if (!rec.ok) return { ok: false, error: rec.error };
    return { ok: true, matched: rec.result.matched, withDiff: rec.result.withDiff, unmatched: rec.result.unmatched };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل سحب المخزون" };
  }
}
