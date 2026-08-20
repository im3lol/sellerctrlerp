import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import { ensurePlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { ingestOrders, ingestProducts, reconcileInventory, enrichItems, linkVariationFamilies, type PlatformCtx, type ProductSyncMode } from "@/lib/erp/marketplace/ingest";
import type { AutoMode } from "@/lib/erp/fulfillment";
import { upsertSettlementTxns, postSettlements } from "@/lib/erp/settlement-core";
import { upsertPlatformReturns, processPlatformReturns, fromFbaReturn } from "@/lib/erp/returns-core";
import { upsertReimbursements, upsertLedgerEvents } from "@/lib/erp/fba-finance-core";
import { upsertPlatformRemovals } from "@/lib/erp/removals-core";
import { platformItemFees, itemCodes, items, platformBalances } from "@/db/schema";
import type { MarketplaceConnector, Credential } from "@/lib/erp/marketplace/connector";
import { isAuthError as isAmazonAuthError } from "@/lib/erp/marketplace/amazon/client";
import type { DateRange, MarketplaceProduct } from "@/lib/erp/marketplace/dto";
import { chunk } from "@/lib/erp/chunk";
import { normalizeCode as normalizeItemCode } from "@/lib/erp/item-codes";
import { orderCreateFloor } from "./sync-range";
import { log } from "@/lib/log";

// Session-less marketplace sync core — shared by the "مزامنة الآن" button actions
// (which add auth on top) and the auto-sync cron (which has no user session).

export type SyncFlags = { products: boolean; orders: boolean; inventory: boolean; settlements: boolean; returns: boolean; removals: boolean };
export type SyncPrep = { orgId: string; connector: MarketplaceConnector; cred: Credential; ctx: PlatformCtx; mode: ProductSyncMode; provider: string; flags: SyncFlags; autoPostSettlements: boolean };

export type ProductsSync = { ok: true; total: number; linked: number; created: number; alreadyLinked: number; skippedUnmatched: number; fnskus: number; images: number; barcodes: number; fields: number; families: number } | { ok: false; error: string };
/** Light status shape for the sync-progress popup (queue path reads it from sync_runs). */
export type ProductSyncStatus = { phase: "running" | "done" | "error" | "idle"; total?: number; created?: number; linked?: number; error?: string };
export type OrdersSync = { ok: true; created: number; fulfilled: number; transitioned: number; cancelled: number; skippedDuplicate: number; skippedUnmatched: number; skippedPreGoLive: number; stockBlocked: number; stockDrafted: number; failed: number } | { ok: false; error: string };
export type InventorySync = { ok: true; matched: number; withDiff: number; unmatched: number } | { ok: false; error: string };
export type FbaCodesSync = { ok: true; total: number; attached: number; unmatched: number } | { ok: false; error: string };
export type BalanceSync = { ok: true; groups: number } | { ok: false; error: string };

/**
 * Load the connector, decrypted credential, platform ctx and settings — no auth.
 *
 * The DB work self-scopes to the org so the caller need NOT hold an RLS scope
 * across the whole sync (the sync interleaves multi-second SP-API fetches with
 * DB writes; holding one connection/transaction the whole time would starve the
 * pool). `withOrgScope` no-ops if a scope is already open (the cron wraps the
 * whole loop in `withPlatformScope`), so the cron path is unchanged.
 */
export async function prepareSync(orgId: string, code: string): Promise<SyncPrep | { error: string }> {
  const connector = getConnector(code);
  if (!connector) return { error: "لا يوجد موصّل لهذه المنصة" };
  const provider = connector.code.toLowerCase();

  return withOrgScope(orgId, false, async () => {
    const [row] = await db.select().from(platformCredentials)
      .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider))).limit(1);
    if (!row) return { error: "المنصة غير مربوطة — اربط الحساب أولًا" };
    const refreshToken = decryptSecret(row.refreshToken);
    if (!refreshToken) return { error: "تعذّر فك تشفير التوكن — أعد ربط الحساب" };
    const cred: Credential = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };

    await ensurePlatform(orgId, connector.code);
    const [p] = await db.select({ id: salesPlatforms.id, customerId: salesPlatforms.customerId, warehouseId: salesPlatforms.defaultWarehouseId, name: salesPlatforms.name, mode: salesPlatforms.productSyncMode, syncProducts: salesPlatforms.syncProducts, syncOrders: salesPlatforms.syncOrders, syncInventory: salesPlatforms.syncInventory, syncSettlements: salesPlatforms.syncSettlements, syncReturns: salesPlatforms.syncReturns, syncRemovals: salesPlatforms.syncRemovals, autoPostSettlements: salesPlatforms.autoPostSettlements, autoMode: salesPlatforms.autoMode, accountingStartDate: salesPlatforms.accountingStartDate, fulfillmentType: salesPlatforms.fulfillmentType })
      .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, connector.code))).limit(1);
    if (!p?.customerId) return { error: "المنصة بلا عميل مرتبط" };

    const ctx: PlatformCtx = { platformId: p.id, customerId: p.customerId, warehouseId: p.warehouseId, channel: connector.code, label: p.name, autoMode: (p.autoMode as AutoMode) ?? "invoice", accountingStartDate: p.accountingStartDate ? new Date(p.accountingStartDate) : null, fulfillmentType: p.fulfillmentType };
    const flags: SyncFlags = { products: p.syncProducts, orders: p.syncOrders, inventory: p.syncInventory, settlements: p.syncSettlements, returns: p.syncReturns, removals: p.syncRemovals };
    return { orgId, connector, cred, ctx, mode: (p.mode as ProductSyncMode) ?? "create", provider, flags, autoPostSettlements: p.autoPostSettlements };
  });
}

export { incrementalFrom, SYNC_OVERLAP_MS, orderCreateFloor } from "./sync-range";

export async function markSync(orgId: string, provider: string, patch: Partial<{ lastSyncStatus: string; needsReauth: boolean; productsSyncedAt: Date; ordersSyncedAt: Date; settlementsSyncedAt: Date; returnsSyncedAt: Date; removalsSyncedAt: Date; reimbursementsSyncedAt: Date; ledgerSyncedAt: Date; feesSyncedAt: Date }> = {}) {
  await withOrgScope(orgId, false, () =>
    db.update(platformCredentials).set({ lastSyncAt: new Date(), updatedAt: new Date(), ...patch })
      .where(and(eq(platformCredentials.organizationId, orgId), eq(platformCredentials.provider, provider))));
}

/**
 * Shared failure path for the sync*Core catches: a revoked token (LWA
 * invalid_grant) flags the credential so the scheduler stops hammering LWA
 * until the org reconnects; anything else is a normal transient failure.
 */
async function coreFail(p: SyncPrep, e: unknown, fallback: string): Promise<{ ok: false; error: string }> {
  const authErr = p.connector.isAuthError?.(e) ?? isAmazonAuthError(e);
  if (authErr) {
    // Alert once on the transition into needs-reauth (not on every retry, or the
    // scheduler would page on each pass). log.error forwards to Telegram — otherwise a
    // revoked token silently stops the seller's orders with no signal beyond the settings page.
    const [cur] = await withOrgScope(p.orgId, false, () =>
      db.select({ needsReauth: platformCredentials.needsReauth }).from(platformCredentials)
        .where(and(eq(platformCredentials.organizationId, p.orgId), eq(platformCredentials.provider, p.provider))).limit(1));
    await markSync(p.orgId, p.provider, { needsReauth: true, lastSyncStatus: "reauth" }).catch(() => {});
    if (!cur?.needsReauth) {
      log.error("marketplace.reauth_required", { orgId: p.orgId, provider: p.provider, channel: p.connector.code, label: p.connector.label });
    }
    return { ok: false, error: `انتهت صلاحية ربط ${p.connector.label} — أعد ربط الحساب` };
  }
  return { ok: false, error: e instanceof Error ? e.message : fallback };
}

/**
 * Products: link/create + catalog enrichment (image/brand/dims/barcodes/families).
 * Pass `since` for an incremental pull (only listings changed since then) — fast,
 * and doesn't re-run the whole catalog; omit it for a full sync/reconciliation.
 */
/** Ingest a fetched product list + run best-effort catalog enrichment. Shared by
 *  the incremental sync (syncProductsCore) and the full import (importProductsCore). */
async function ingestAndEnrich(p: SyncPrep, products: MarketplaceProduct[]): Promise<ProductsSync> {
  const org = p.orgId;
  const r = await withOrgScope(org, false, () => ingestProducts(org, products, p.mode, p.connector.code));

  let images = 0, barcodes = 0, fields = 0, families = 0;
  const fetchCatalog = p.connector.fetchCatalog;
  if (fetchCatalog) {
    const asins = [...new Set(products.map((x) => x.altCode).filter((a): a is string => !!a))];
    if (asins.length) {
      try {
        const records = await fetchCatalog(p.cred, asins);
        const e = await withOrgScope(org, false, () => enrichItems(org, records));
        images = e.images; barcodes = e.barcodes; fields = e.fields;
        // linkVariationFamilies fetches the parent catalog via the callback; that
        // secondary fetch runs inside this scope. ponytail: acceptable (parent set
        // is small); split fetch/write inside ingest if it ever dominates.
        const fam = await withOrgScope(org, false, () => linkVariationFamilies(org, records, async (parentAsins) => {
          const precs = await fetchCatalog(p.cred, parentAsins);
          const m = new Map<string, { name?: string; imageUrl?: string }>();
          for (const pr of precs) m.set(pr.asin, { name: pr.name, imageUrl: pr.imageUrl });
          return m;
        }));
        families = fam.familiesLinked;
      } catch { /* enrichment is optional */ }
    }
  }
  return { ok: true, ...r, images, barcodes, fields, families };
}

export async function syncProductsCore(p: SyncPrep, since?: Date): Promise<ProductsSync> {
  if (!p.connector.fetchProducts) return { ok: false, error: "المنصة لا تدعم مزامنة المنتجات" };
  try {
    // Fetch OUTSIDE the DB scope (slow SP-API call), then ingest INSIDE a short
    // org scope — so the DB connection isn't held across the network round-trip.
    const products = await p.connector.fetchProducts(p.cred, since);
    return await ingestAndEnrich(p, products);
  } catch (e) {
    return coreFail(p, e, "فشل سحب المنتجات");
  }
}

/**
 * Full catalog import — complete enumeration via `fetchFullProducts` (Amazon Reports
 * API, no 1000 cap), falling back to `fetchProducts` (inventory+listings merge) if the
 * report path fails, so the import always completes. Slow (minutes) → workers only.
 */
/**
 * Backfill Amazon's FNSKU onto the items that already exist.
 *
 * The FNSKU rides free on getInventorySummaries, so the live product sync now attaches
 * it as it goes — but that only covers what a product sync touches. Two gaps need this
 * separate pass: an established catalog linked long before the code existed, and the
 * full import, which reads GET_MERCHANT_LISTINGS_ALL_DATA — a report with no FNSKU
 * column at all.
 *
 * Read-only against Amazon and additive against the catalog: it writes item_codes rows
 * and nothing else, and the upsert makes a second run a no-op. FBM SKUs carry no FNSKU
 * and are simply absent from the feed.
 */
export async function syncFbaCodesCore(p: SyncPrep): Promise<FbaCodesSync> {
  const fetchDetail = p.connector.fetchInventoryDetail;
  if (!fetchDetail) return { ok: false, error: "المنصة لا تدعم مخزون FBA" };
  try {
    // Fetch outside the org scope — the whole FBA catalog is minutes of SP-API paging
    // and must not hold a DB connection open.
    const detail = await fetchDetail(p.cred);
    const rows = detail.filter((d) => d.fnsku && d.code);
    if (!rows.length) return { ok: true, total: detail.length, attached: 0, unmatched: detail.length };

    return await withOrgScope(p.orgId, false, async () => {
      // SKU or ASIN → itemId, the same resolution the inventory audit uses.
      const norms = [...new Set(rows.flatMap((d) => [normalizeItemCode(d.code), d.asin ? normalizeItemCode(d.asin) : ""]).filter(Boolean))];
      const byNorm = new Map<string, string>();
      for (const b of chunk(norms, 800)) {
        const found = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
          .where(and(eq(itemCodes.organizationId, p.orgId), inArray(itemCodes.normalizedCode, b)));
        for (const r of found) if (r.norm && !byNorm.has(r.norm)) byNorm.set(r.norm, r.itemId);
      }

      const values: { itemId: string; organizationId: string; codeType: string; code: string; normalizedCode: string }[] = [];
      const seen = new Set<string>();
      let unmatched = 0;
      for (const d of rows) {
        const itemId = byNorm.get(normalizeItemCode(d.code)) ?? (d.asin ? byNorm.get(normalizeItemCode(d.asin)) : undefined);
        if (!itemId) { unmatched++; continue; }
        const code = d.fnsku!.trim();
        const norm = normalizeItemCode(code);
        const key = `${itemId}|${code}`;
        if (!norm || seen.has(key)) continue;
        seen.add(key);
        values.push({ itemId, organizationId: p.orgId, codeType: "FNSKU", code, normalizedCode: norm });
      }
      for (const slice of chunk(values, 500)) {
        await db.insert(itemCodes).values(slice)
          .onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
      }
      return { ok: true as const, total: detail.length, attached: values.length, unmatched };
    });
  } catch (e) {
    return coreFail(p, e, "فشل سحب أكواد FBA");
  }
}

export async function importProductsCore(p: SyncPrep): Promise<ProductsSync> {
  try {
    let products: MarketplaceProduct[];
    if (p.connector.fetchFullProducts) {
      try {
        products = await p.connector.fetchFullProducts(p.cred);
      } catch (e) {
        if (!p.connector.fetchProducts) throw e;
        products = await p.connector.fetchProducts(p.cred); // report failed → live fallback
      }
    } else if (p.connector.fetchProducts) {
      products = await p.connector.fetchProducts(p.cred);
    } else {
      return { ok: false, error: "المنصة لا تدعم مزامنة المنتجات" };
    }
    return await ingestAndEnrich(p, products);
  } catch (e) {
    return coreFail(p, e, "فشل الاستيراد");
  }
}

// --- Background full product sync -------------------------------------------
// A full pull is LONG (11k+ SKUs from FBA inventory + catalog enrichment ≈ minutes)
// — too long for a synchronous browser request (the connection drops). Run it
// fire-and-forget on this long-lived Node process; the UI polls getProductSyncState.
// ponytail: in-memory + single-process (one Docker container). Move to a DB/redis
// job row only if the app ever runs multiple instances.
type ProductSyncState = { phase: "running" | "done" | "error"; result?: ProductsSync; at: number };
const productSyncJobs = new Map<string, ProductSyncState>();
const jobKey = (orgId: string, provider: string) => `${orgId}:${provider}`;

export function getProductSyncState(orgId: string, provider: string): ProductSyncState | null {
  return productSyncJobs.get(jobKey(orgId, provider)) ?? null;
}

/** Kick off a full product sync in the background; returns immediately. */
export function startProductSync(p: SyncPrep): { started: boolean; alreadyRunning: boolean } {
  const key = jobKey(p.orgId, p.provider);
  if (productSyncJobs.get(key)?.phase === "running") return { started: false, alreadyRunning: true };
  productSyncJobs.set(key, { phase: "running", at: Date.now() });
  void (async () => {
    try {
      const r = await syncProductsCore(p);
      if (r.ok) await markSync(p.orgId, p.provider, { lastSyncStatus: "ok", productsSyncedAt: new Date() });
      productSyncJobs.set(key, { phase: r.ok ? "done" : "error", result: r, at: Date.now() });
    } catch (e) {
      productSyncJobs.set(key, { phase: "error", result: { ok: false, error: e instanceof Error ? e.message : "فشل السحب" }, at: Date.now() });
    }
  })();
  return { started: true, alreadyRunning: false };
}

/** Orders: pull the given window and drive the sales-order cycle. userId=null in cron. */
export async function syncOrdersCore(p: SyncPrep, userId: string | null, range: DateRange): Promise<OrdersSync> {
  if (!p.connector.fetchOrders) return { ok: false, error: "المنصة لا تدعم مزامنة الأوامر" };
  try {
    const orders = await p.connector.fetchOrders(p.cred, range); // slow fetch, unscoped
    // Create-floor = only import orders PLACED on/after this. Incremental/realtime
    // ("updated" = LastUpdatedAfter) can surface OLD orders Amazon just touched — floor
    // them at the go-live start date (else start of today: new orders only). An explicit
    // "created" backfill trusts its picked window (already floored at the start date).
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const createFloor = orderCreateFloor(range.mode, p.ctx.accountingStartDate ?? null, range.from, startOfToday);
    const r = await withOrgScope(p.orgId, false, () => ingestOrders(p.orgId, userId, { ...p.ctx, createFloor }, orders));
    return { ok: true, created: r.created, fulfilled: r.fulfilled, transitioned: r.transitioned, cancelled: r.cancelled, skippedDuplicate: r.skippedDuplicate, skippedUnmatched: r.skippedUnmatched, skippedPreGoLive: r.skippedPreGoLive, stockBlocked: r.stockBlocked.length, stockDrafted: r.stockDrafted, failed: r.failed };
  } catch (e) {
    return coreFail(p, e, "فشل سحب الأوامر");
  }
}

export type SettlementsSync = { ok: true; imported: number; updated: number; posted: number; deferredHeld: number; returnsCreated: number } | { ok: false; error: string };

/**
 * Settlements: pull the scheduled settlement reports in `range`, upsert the rows,
 * and (only when the platform's autoPostSettlements is on) post them to GL. When
 * auto-post is off the rows sit unposted for the operator to review + post. The
 * fetch runs OUTSIDE the DB scope; the upsert/post run INSIDE short org scopes.
 * ponytail: in the worker (no session) the refund credit-note sub-step of
 * postSettlements can't authorize, so refunds are flagged and left for a manual
 * post — the money aggregate + subledger still post correctly.
 */
export async function syncSettlementsCore(p: SyncPrep, range: DateRange): Promise<SettlementsSync> {
  if (!p.connector.fetchSettlements) return { ok: false, error: "المنصة لا تدعم مزامنة التسويات" };
  try {
    const txns = await p.connector.fetchSettlements(p.cred, range); // slow fetch, unscoped
    const up = await withOrgScope(p.orgId, false, () => upsertSettlementTxns(p.orgId, txns, p.connector.code));
    let posted = 0, deferredHeld = 0, returnsCreated = 0;
    if (p.autoPostSettlements) {
      const res = await withOrgScope(p.orgId, false, () => postSettlements(p.orgId, null, p.connector.code));
      if ("error" in res) return { ok: false, error: res.error };
      posted = res.posted; deferredHeld = res.deferredHeld; returnsCreated = res.returnsCreated;
    }
    // One extra request, and it is what makes the wallet auditable. Never let it break
    // the settlement sync — the money rows are the part that matters.
    if (p.connector.fetchBalance) await syncBalanceCore(p).catch(() => undefined);
    return { ok: true, imported: up.imported, updated: up.updated, posted, deferredHeld, returnsCreated };
  } catch (e) {
    return coreFail(p, e, "فشل سحب التسويات");
  }
}

/**
 * Store what the marketplace says it is holding, so the wallet GL has something to be
 * reconciled against instead of only ever agreeing with itself.
 *
 * Best-effort and read-only: the balance is a reconciliation aid, not an accounting
 * input — nothing is posted from it, and a failure here must never fail the payments
 * sync it rides along with.
 */
export async function syncBalanceCore(p: SyncPrep): Promise<BalanceSync> {
  const fetch = p.connector.fetchBalance;
  if (!fetch) return { ok: false, error: "المنصة لا توفر رصيد الحساب" };
  try {
    const rows = await fetch(p.cred); // slow fetch, unscoped
    if (!rows.length) return { ok: true, groups: 0 };
    await withOrgScope(p.orgId, false, async () => {
      for (const b of rows) {
        if (!b.currency) continue;
        const values = {
          organizationId: p.orgId, channel: p.connector.code, currency: b.currency,
          balance: String(b.balance), openingBalance: String(b.openingBalance),
          groupId: b.groupId || null, periodStart: b.periodStart, periodEnd: b.periodEnd,
          fundTransferStatus: b.fundTransferStatus, accountTail: b.accountTail,
          fetchedAt: new Date(), updatedAt: new Date(),
        };
        await db.insert(platformBalances).values(values).onConflictDoUpdate({
          target: [platformBalances.organizationId, platformBalances.channel, platformBalances.currency],
          set: values,
        });
      }
    });
    return { ok: true, groups: rows.length };
  } catch (e) {
    return coreFail(p, e, "فشل قراءة رصيد الحساب");
  }
}

/** Inventory: read-only reconciliation (a DRAFT adjustment is confirmed separately). */
export async function syncInventoryCore(p: SyncPrep): Promise<InventorySync> {
  if (!p.connector.fetchInventory || !p.ctx.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  const wh = p.ctx.warehouseId;
  try {
    const inv = await p.connector.fetchInventory(p.cred); // slow fetch, unscoped
    const rec = await withOrgScope(p.orgId, false, () => reconcileInventory(p.orgId, { defaultWarehouseId: wh }, inv));
    if (!rec.ok) return { ok: false, error: rec.error };
    return { ok: true, matched: rec.result.matched, withDiff: rec.result.withDiff, unmatched: rec.result.unmatched };
  } catch (e) {
    return coreFail(p, e, "فشل سحب المخزون");
  }
}

export type ReturnsSync = { ok: true; imported: number; created: number; linkedToSettlement: number; unmatched: number } | { ok: false; error: string };

/** FBA returns: pull the window's returns report, upsert rows, then create/link
 *  DRAFT مرتجعات. Document creation needs an ErpContext (worker identity). */
export async function syncReturnsCore(p: SyncPrep, range: DateRange): Promise<ReturnsSync> {
  if (!p.connector.fetchReturns) return { ok: false, error: "المنصة لا تدعم مزامنة المرتجعات" };
  try {
    const rows = await p.connector.fetchReturns(p.cred, range); // slow fetch, unscoped
    const up = await withOrgScope(p.orgId, false, () => upsertPlatformReturns(p.orgId, rows.map(fromFbaReturn), p.connector.code));
    const pr = await withOrgScope(p.orgId, false, () => processPlatformReturns(p.orgId));
    return { ok: true, imported: up.imported, ...pr };
  } catch (e) {
    return coreFail(p, e, "فشل سحب المرتجعات");
  }
}

export type FeedSync = { ok: true; imported: number; skipped: number } | { ok: false; error: string };

/** FBA reimbursements: read-only upsert of the window's report. */
export async function syncReimbursementsCore(p: SyncPrep, range: DateRange): Promise<FeedSync> {
  if (!p.connector.fetchReimbursements) return { ok: false, error: "المنصة لا تدعم التعويضات" };
  try {
    const rows = await p.connector.fetchReimbursements(p.cred, range);
    const up = await withOrgScope(p.orgId, false, () => upsertReimbursements(p.orgId, rows));
    return { ok: true, ...up };
  } catch (e) {
    return coreFail(p, e, "فشل سحب التعويضات");
  }
}

/** FBA removal orders: upsert the window's report rows (idempotent). The trader confirms
 *  each one (restock received / write-off disposed) from the removals workspace — nothing
 *  posts here. */
export async function syncRemovalsCore(p: SyncPrep, range: DateRange): Promise<{ ok: true; imported: number } | { ok: false; error: string }> {
  if (!p.connector.fetchRemovals) return { ok: false, error: "المنصة لا تدعم أوامر السحب" };
  try {
    const rows = await p.connector.fetchRemovals(p.cred, range);
    const up = await withOrgScope(p.orgId, false, () => upsertPlatformRemovals(p.orgId, rows, p.connector.code));
    return { ok: true, imported: up.imported };
  } catch (e) {
    return coreFail(p, e, "فشل سحب أوامر السحب");
  }
}

/** FBA ledger detail: read-only upsert of the window's inventory events. */
export async function syncLedgerCore(p: SyncPrep, range: DateRange): Promise<FeedSync> {
  if (!p.connector.fetchLedgerEvents) return { ok: false, error: "المنصة لا تدعم دفتر FBA" };
  try {
    const rows = await p.connector.fetchLedgerEvents(p.cred, range);
    const up = await withOrgScope(p.orgId, false, () => upsertLedgerEvents(p.orgId, rows));
    return { ok: true, ...up };
  } catch (e) {
    return coreFail(p, e, "فشل سحب دفتر FBA");
  }
}

export type FeesSync = { ok: true; estimated: number; itemsConsidered: number } | { ok: false; error: string };

/** Fee estimates: for every Amazon-linked item with a sell price, refresh the
 *  estimated referral/FBA fees (upsert — estimates change with price). */
export async function syncFeesCore(p: SyncPrep): Promise<FeesSync> {
  const fetchFees = p.connector.fetchFees;
  if (!fetchFees) return { ok: false, error: "المنصة لا تدعم تقدير الرسوم" };
  try {
    // Amazon-linked items = those with a SKU code on this channel. sku → itemId.
    const linked = await withOrgScope(p.orgId, false, () =>
      db.select({ itemId: itemCodes.itemId, code: itemCodes.code, sellPrice: items.sellPrice })
        .from(itemCodes)
        .innerJoin(items, eq(items.id, itemCodes.itemId))
        .where(and(eq(itemCodes.organizationId, p.orgId), eq(itemCodes.codeType, "SKU"))));
    const bySku = new Map<string, { itemId: string; price: number }>();
    for (const l of linked) {
      const price = Number(l.sellPrice) || 0;
      if (price > 0) bySku.set(l.code, { itemId: l.itemId, price });
    }
    if (bySku.size === 0) return { ok: true, estimated: 0, itemsConsidered: 0 };

    const estimates = await fetchFees(p.cred, [...bySku.entries()].map(([sku, v]) => ({ sku, price: v.price })));

    let estimated = 0;
    await withOrgScope(p.orgId, false, async () => {
      for (const fe of estimates) {
        const link = bySku.get(fe.sku);
        if (!link) continue;
        await db.insert(platformItemFees).values({
          organizationId: p.orgId, channel: p.connector.code, itemId: link.itemId,
          marketplaceId: p.cred.marketplaceId, currency: fe.currency ?? null,
          referralFee: String(fe.referralFee), fbaFee: String(fe.fbaFee), totalFees: String(fe.totalFees),
          priceUsed: String(link.price), fees: fe.raw, estimatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [platformItemFees.organizationId, platformItemFees.itemId, platformItemFees.channel],
          set: {
            marketplaceId: p.cred.marketplaceId, currency: fe.currency ?? null,
            referralFee: String(fe.referralFee), fbaFee: String(fe.fbaFee), totalFees: String(fe.totalFees),
            priceUsed: String(link.price), fees: fe.raw, estimatedAt: new Date(),
          },
        });
        estimated++;
      }
    });
    return { ok: true, estimated, itemsConsidered: bySku.size };
  } catch (e) {
    return coreFail(p, e, "فشل تقدير الرسوم");
  }
}
