import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes, itemCategories, unitsOfMeasure, salesOrders, salesOrderLines, warehouses, deliveryNotes, unmatchedOrders, exchangeRates, organizations } from "@/db/schema";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { orderToBase, isForeign } from "./order-fx";
import { splitInclusiveOrderVat } from "@/lib/erp/vat";
import { log } from "@/lib/log";
import { round2 } from "@/lib/erp/money";
import { chunk } from "@/lib/erp/chunk";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { tryRecordAudit } from "@/lib/erp/audit";
import { confirmSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { fulfillOrder, cancelMarketplaceOrder, STOCK_WAIT_MARK, type AutoMode } from "@/lib/erp/fulfillment";
import { currentStock } from "@/lib/erp/inventory";
import { classifyOrders, classifyProducts, type PreviewOrder, type OrdersPreview, type ItemResolver } from "./classify";
import { validateParentLink } from "@/lib/erp/item-family-core";
import { CHANNEL_CODE_TYPE } from "@/lib/erp/marketplace-code";
import type { MarketplaceOrder, MarketplaceInventory, MarketplaceProduct } from "./dto";
import type { CatalogRecord } from "./connector";

export { classifyOrders };
export type { OrdersPreview };
export type { MatchedLine } from "./classify";

// Get-or-create the org's default "قطعة" unit so synced items aren't unit-less
// (a fresh tenant has no units at all). Keyed by the stable code "PCS".
async function pieceUomId(orgId: string): Promise<string> {
  const find = async () => (await db.select({ id: unitsOfMeasure.id }).from(unitsOfMeasure)
    .where(and(eq(unitsOfMeasure.organizationId, orgId), eq(unitsOfMeasure.code, "PCS"))).limit(1))[0]?.id;
  const existing = await find();
  if (existing) return existing;
  await db.insert(unitsOfMeasure).values({ organizationId: orgId, code: "PCS", nameAr: "قطعة", nameEn: "Piece" })
    .onConflictDoNothing({ target: [unitsOfMeasure.organizationId, unitsOfMeasure.code] });
  return (await find())!;
}

// Get-or-create an item category by its Arabic name (from the marketplace catalog).
// A tiny per-call cache avoids re-querying for repeated category names.
async function categoryIdByName(orgId: string, name: string, cache: Map<string, string>): Promise<string | null> {
  const key = name.trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit) return hit;
  const find = async () => (await db.select({ id: itemCategories.id }).from(itemCategories)
    .where(and(eq(itemCategories.organizationId, orgId), eq(itemCategories.nameAr, key))).limit(1))[0]?.id;
  let id = await find();
  if (!id) {
    // Category code must be unique per org — derive a stable-ish slug from the name.
    const code = ("AMZ-" + key.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40)).toUpperCase();
    await db.insert(itemCategories).values({ organizationId: orgId, code, nameAr: key })
      .onConflictDoNothing({ target: [itemCategories.organizationId, itemCategories.code] });
    id = await find();
  }
  if (id) cache.set(key, id);
  return id ?? null;
}

/**
 * Vendor-neutral write layer. Connectors and the manual-import actions both hand
 * their parsed data here as DTOs, so all order/inventory logic (matching, the
 * DRAFT→fulfil cycle, reconciliation) lives once and the ERP never knows the
 * source. Ported from the former Amazon-specific actions with no behaviour change.
 */
export type PlatformCtx = {
  platformId: string | null; customerId: string; warehouseId: string | null; channel: string; label: string; autoMode?: AutoMode;
  /** The platform's default fulfillment (FBA/FBM) — used when the order itself doesn't report one. */
  fulfillmentType?: string | null;
  /** The platform's go-live accounting start date, if set. syncOrdersCore derives
   *  `createFloor` from it per sync mode. */
  accountingStartDate?: Date | null;
  /** Don't CREATE an order whose purchase date is before this (go-live floor). Old
   *  orders Amazon merely updated (via LastUpdatedAfter syncs) are skipped, not
   *  imported — their money closes through settlements. Null = no floor (manual file
   *  import). Updates/cancels to already-imported orders are unaffected. */
  createFloor?: Date | null;
};

export type IngestResult = {
  created: number;
  transitioned: number;
  fulfilled: number;
  cancelled: number;
  stockBlocked: { externalId: string; reason: string }[];
  stockDrafted: number; // deliveries parked as DRAFT waiting for stock
  skippedDuplicate: number;
  skippedUnmatched: number;
  skippedPreGoLive: number; // new orders skipped: purchase date before the go-live floor
  autoCreated: number; // stub items created for unknown SKUs (order kept DRAFT)
  failed: number;
};

/** Build a code/altCode → item resolver for the org (item_codes, then item.code). */
export async function buildMatcher(orgId: string, orders: MarketplaceOrder[]) {
  const norms = new Set<string>();
  for (const o of orders) for (const l of o.lines) {
    if (l.code) norms.add(normalizeCode(l.code));
    if (l.altCode) norms.add(normalizeCode(l.altCode));
  }
  const normList = [...norms].filter(Boolean);
  // norm → the SET of items carrying it. A shared code (ASIN, barcode) can belong to several
  // products, so we keep all of them and only match when exactly ONE owns the code — never
  // guess an arbitrary product from an ambiguous shared code.
  const byNorm = new Map<string, Set<string>>();
  for (let i = 0; i < normList.length; i += 800) {
    const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId })
      .from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, normList.slice(i, i + 800))));
    for (const r of rows) if (r.norm) { let s = byNorm.get(r.norm); if (!s) byNorm.set(r.norm, (s = new Set())); s.add(r.itemId); }
  }

  const itemRows = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
    .from(items).where(eq(items.organizationId, orgId));
  const nameById = new Map<string, string>();
  const byItemCode = new Map<string, string>(); // items.code is unique per org → single owner
  for (const it of itemRows) {
    nameById.set(it.id, it.nameAr || it.code);
    byItemCode.set(normalizeCode(it.code), it.id);
  }

  const hit = (id: string) => ({ itemId: id, itemName: nameById.get(id) ?? null });
  return (code: string, altCode?: string): { itemId: string | null; itemName: string | null } => {
    // Try the line's own code first (the seller SKU — unique), then altCode (ASIN — shared).
    for (const c of [code, altCode]) {
      const n = normalizeCode(c || "");
      if (!n) continue;
      const direct = byItemCode.get(n);
      if (direct) return hit(direct);                       // internal item.code — unambiguous
      const owners = byNorm.get(n);
      if (owners && owners.size === 1) return hit([...owners][0]); // exactly one product owns it
      // owners.size > 1 → ambiguous shared code → don't guess; fall through to the next code.
    }
    return { itemId: null, itemName: null };
  };
}

async function existingOrders(orgId: string, channel: string): Promise<Map<string, { id: string; status: string }>> {
  const rows = await db.select({ ext: salesOrders.externalOrderId, id: salesOrders.id, status: salesOrders.status }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, channel)));
  const m = new Map<string, { id: string; status: string }>();
  for (const r of rows) if (r.ext) m.set(r.ext, { id: r.id, status: r.status });
  return m;
}

/** Parse+match preview (no writes). */
export async function previewOrders(orgId: string, ctx: Pick<PlatformCtx, "channel">, orders: MarketplaceOrder[]): Promise<OrdersPreview> {
  const resolve = await buildMatcher(orgId, orders);
  const existing = await existingOrders(orgId, ctx.channel);
  return classifyOrders(orders, resolve, existing);
}

/**
 * Create a sales order per eligible order and drive its cycle: Shipped → confirm +
 * delivery + posted invoice; Pending stays DRAFT; existing Pending→Shipped are
 * transitioned + fulfilled. Orders short on stock are reported, never a negative
 * movement. Idempotent via (org, channel, externalId).
 */
export async function ingestOrders(orgId: string, userId: string | null, ctx: PlatformCtx, orders: MarketplaceOrder[]): Promise<IngestResult> {
  const resolve = await buildMatcher(orgId, orders);
  // We NEVER auto-create products from a marketplace order — that duplicates items across
  // platforms and pollutes the catalog. An order whose SKU isn't linked to a product is
  // parked in unmatched_orders + surfaced as a notification; the seller creates the product
  // (with its platform codes) and the order manually. See recordUnmatched below.
  const autoCreated = 0;
  const reviewIds = new Set(
    (await db.select({ id: items.id }).from(items).where(and(eq(items.organizationId, orgId), eq(items.needsReview, true)))).map((r) => r.id),
  );
  const hasReviewItem = (o: PreviewOrder) => o.lines.some((l) => l.itemId && reviewIds.has(l.itemId));
  // The fulfil cycle (deliver + invoice) runs cookie-bound server actions, so it
  // needs an identity: a session (manual sync) or the worker's ambient ErpContext
  // (runOrdersJob passes the acting user's id). userId=null → import DRAFT only.
  const canFulfill = userId != null;

  // Multi-currency: the ERP stores documents/GL in base currency. Convert any foreign-currency
  // order (e.g. amazon.ae in AED) to base at the latest exchange rate on file BEFORE classify —
  // otherwise its raw magnitude posts as if it were base (EGP). An order in a foreign currency
  // with NO rate on file is left unconverted; the loops below keep it DRAFT (never auto-invoice a
  // wrong-currency order) and we alert once per currency.
  const base = await getBaseCurrencyCode(orgId);
  // Marketplace prices are VAT-INCLUSIVE — carve the VAT component out at ingest so the
  // order/invoice recognises output VAT (2102) instead of booking 100% of channel revenue
  // as tax-free. The gross total is preserved (settlement still reconciles).
  const [orgRow] = await db.select({ vatRate: organizations.vatRate }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const vatRate = Number(orgRow?.vatRate ?? 0);
  const foreignCodes = [...new Set(orders.filter((o) => isForeign(o, base)).map((o) => o.currency!))];
  const rateBy = new Map<string, number>();
  if (foreignCodes.length) {
    const rows = await db.select({ code: exchangeRates.currencyCode, rate: exchangeRates.rate, date: exchangeRates.date })
      .from(exchangeRates)
      .where(and(eq(exchangeRates.organizationId, orgId), inArray(exchangeRates.currencyCode, foreignCodes)))
      .orderBy(exchangeRates.currencyCode, desc(exchangeRates.date));
    for (const r of rows) if (!rateBy.has(r.code)) rateBy.set(r.code, Number(r.rate)); // first per code = latest
  }
  const fxAlerted = new Set<string>();
  const prepped = orders.map((o) => {
    if (!isForeign(o, base)) return o;
    const rate = rateBy.get(o.currency!);
    if (rate && rate > 0) return orderToBase(o, rate, base);
    if (!fxAlerted.has(o.currency!)) { fxAlerted.add(o.currency!); log.error("marketplace.fx_rate_missing", { orgId, channel: ctx.channel, currency: o.currency }); }
    return o; // unconverted → stays DRAFT below
  });

  const existing = await existingOrders(orgId, ctx.channel);
  const { toCreate, transitions, toCancel, duplicates, blocked } = classifyOrders(prepped, resolve, existing);

  // Park each unmatched order (unknown product) for manual handling, and clear any parked
  // order that now resolves (its product was created since). Best-effort: a parking hiccup
  // must never block the matched orders from importing.
  try {
    if (blocked.length) {
      await db.insert(unmatchedOrders).values(blocked.map((o) => ({
        organizationId: orgId, channel: ctx.channel, externalId: o.externalId, payload: o, status: "PENDING", updatedAt: new Date(),
      }))).onConflictDoUpdate({
        target: [unmatchedOrders.organizationId, unmatchedOrders.channel, unmatchedOrders.externalId],
        set: { payload: sql`excluded.payload`, status: "PENDING", updatedAt: new Date() },
      });
    }
    const nowMatched = [...toCreate, ...transitions].map((o) => o.externalId);
    if (nowMatched.length) {
      await db.update(unmatchedOrders).set({ status: "RESOLVED", updatedAt: new Date() })
        .where(and(eq(unmatchedOrders.organizationId, orgId), eq(unmatchedOrders.channel, ctx.channel),
          inArray(unmatchedOrders.externalId, nowMatched), eq(unmatchedOrders.status, "PENDING")));
    }
  } catch (e) {
    console.error("[ingest] unmatched-orders parking failed:", e instanceof Error ? e.message : e);
  }

  let created = 0, transitioned = 0, fulfilled = 0, cancelled = 0, failed = 0, stockDrafted = 0, skippedPreGoLive = 0;
  const stockBlocked: { externalId: string; reason: string }[] = [];
  const autoMode: AutoMode = ctx.autoMode ?? "invoice";
  const createFloor = ctx.createFloor ?? null;

  const insertOrder = async (o: PreviewOrder, status: string): Promise<string | null> => {
    const d = new Date(o.date || Date.now());
    try {
      // Carve VAT out of the inclusive marketplace prices: net subtotal + per-line/order tax,
      // gross line/order totals preserved (settlement still reconciles).
      const vat = splitInclusiveOrderVat(o.lines.map((l) => ({ qty: l.qty, lineTotal: l.lineTotal })), vatRate);
      return await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, orgId, "SO", d.getFullYear());
        const [so] = await tx.insert(salesOrders).values({
          organizationId: orgId, number, customerId: ctx.customerId, date: d, status,
          subtotal: String(vat.subtotalNet), taxAmount: String(vat.taxTotal), shippingAmount: String(o.shippingTotal), discountAmount: String(o.discount ?? 0),
          totalAmount: String(round2(o.subtotal + o.shippingTotal - (o.discount ?? 0))),
          channel: ctx.channel, platformId: ctx.platformId, externalOrderId: o.externalId, channelStatus: o.status,
          fulfillmentType: o.fulfillment ?? ctx.fulfillmentType ?? null,
          notes: `${ctx.label} ${o.externalId}`,
        }).returning({ id: salesOrders.id, number: salesOrders.number });
        await tx.insert(salesOrderLines).values(o.lines.map((l, i) => ({
          salesOrderId: so.id, itemId: l.itemId!, warehouseId: ctx.warehouseId,
          quantity: String(l.qty), unitPrice: String(vat.lines[i].unitPriceNet), taxAmount: String(vat.lines[i].taxAmount), totalAmount: String(l.lineTotal),
        })));
        // Always log — userId is null for the automatic (cron/worker) sync, which the
        // audit card shows as "تلقائي (النظام)". A manual sync carries the actor.
        const actor = userId ?? null;
        await tryRecordAudit({
          orgId, userId: actor, action: "CREATE", entityType: "SALES_ORDER",
          entityId: so.id, entityNumber: so.number,
          summary: `استيراد أمر بيع ${so.number} من ${ctx.label} (${o.externalId})`, metadata: { channel: ctx.channel, externalOrderId: o.externalId, total: o.total },
        });
        // Born confirmed = Amazon already marked it Shipped → record the confirmation too.
        if (status === "CONFIRMED") await tryRecordAudit({
          orgId, userId: actor, action: "CONFIRM", entityType: "SALES_ORDER",
          entityId: so.id, entityNumber: so.number, summary: `تأكيد أمر بيع ${so.number} (مشحون على أمازون)`,
        });
        return so.id;
      });
    } catch {
      return null;
    }
  };

  const cycled = new Set<string>(); // order ids runCycle already touched this sync
  const runCycle = async (orderId: string, extId: string) => {
    if (autoMode === "draft" || autoMode === "order") return; // no auto delivery/invoice in these modes
    cycled.add(orderId);
    const f = await fulfillOrder(orgId, orderId, { mode: autoMode, draftOnShort: true });
    if (f.ok) { if (f.drafted) stockDrafted++; else if (!f.noop) fulfilled++; }
    else if (f.blocked) stockBlocked.push({ externalId: extId, reason: f.error });
    else failed++;
  };

  // Re-write a still-editable DRAFT order's lines + totals + channel status from the
  // latest fetch. Backfills prices Amazon only reveals once an order leaves Pending.
  const refreshDraft = async (existingId: string, o: PreviewOrder) => {
    const newTotal = round2(o.subtotal + o.shippingTotal - (o.discount ?? 0));
    const vat = splitInclusiveOrderVat(o.lines.map((l) => ({ qty: l.qty, lineTotal: l.lineTotal })), vatRate);
    const [prev] = await db.select({ total: salesOrders.totalAmount }).from(salesOrders).where(eq(salesOrders.id, existingId));
    const changed = prev != null && Math.abs(Number(prev.total) - newTotal) > 0.001;
    await db.transaction(async (tx) => {
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.salesOrderId, existingId));
      if (o.lines.length) await tx.insert(salesOrderLines).values(o.lines.map((l, i) => ({
        salesOrderId: existingId, itemId: l.itemId!, warehouseId: ctx.warehouseId,
        quantity: String(l.qty), unitPrice: String(vat.lines[i].unitPriceNet), taxAmount: String(vat.lines[i].taxAmount), totalAmount: String(l.lineTotal),
      })));
      await tx.update(salesOrders).set({
        subtotal: String(vat.subtotalNet), taxAmount: String(vat.taxTotal), shippingAmount: String(o.shippingTotal), discountAmount: String(o.discount ?? 0),
        totalAmount: String(newTotal), channelStatus: o.status, updatedAt: new Date(),
      }).where(eq(salesOrders.id, existingId));
    });
    // Log only a real change (e.g. Amazon released the price after Pending) — not every no-op refresh.
    if (changed) await tryRecordAudit({
      orgId, userId: userId ?? null, action: "UPDATE", entityType: "SALES_ORDER",
      entityId: existingId, summary: `تحديث تلقائي: تحديث بيانات الأمر من أمازون (الإجمالي ${Number(prev!.total)} ← ${newTotal})`,
    });
  };

  for (const o of toCreate) {
    // Go-live floor: only import orders PLACED on/after the start date. An old order
    // Amazon merely updated (pulled by a LastUpdatedAfter sync) is skipped — its money
    // closes through settlements, not a back-dated sales order.
    if (createFloor && new Date(o.date || Date.now()) < createFloor) { skippedPreGoLive++; continue; }
    // A review-stub line has no cost — never auto-confirm/post it. Keep DRAFT.
    // No identity (userId null) → keep DRAFT for a later authenticated sync.
    // autoMode "draft" = the user chose import-as-draft-only: never auto-confirm.
    // A foreign order with no exchange rate on file was left unconverted — never auto-invoice it
    // in the wrong currency; import as DRAFT so a human sets the rate / handles it.
    const shipped = o.status === "Shipped" && !hasReviewItem(o) && canFulfill && autoMode !== "draft" && !isForeign(o, base);
    const id = await insertOrder(o, shipped ? "CONFIRMED" : "DRAFT");
    if (!id) { failed++; continue; }
    created++;
    if (shipped) await runCycle(id, o.externalId);
  }

  for (const o of transitions) {
    if (!o.existingId) continue;
    if (isForeign(o, base)) continue; // unconverted foreign (no rate) → don't refresh/advance in the wrong currency
    if (!o.lines.every((l) => l.itemId)) continue; // a line without an item → leave as-is
    // Backfill price/status onto the DRAFT first (Amazon reveals prices post-Pending).
    if (o.existingStatus === "DRAFT") await refreshDraft(o.existingId, o);
    if (autoMode === "draft") continue; // draft-only mode: refresh the data, never advance
    if (hasReviewItem(o)) continue; // needs item review → stay DRAFT, don't advance
    if (!canFulfill) continue; // worker: refreshed the draft; a browser sync will fulfil it
    // Only advance once Amazon marks it Shipped; a still-Pending order just got refreshed.
    if (o.status !== "Shipped") continue;
    if (o.existingStatus === "DRAFT") {
      const c = await confirmSalesOrderAction(o.existingId);
      if (!c.ok) { failed++; continue; }
      transitioned++;
    }
    await runCycle(o.existingId, o.externalId);
  }

  // Cancellations: tear down DRAFT/CONFIRMED orders (delete draft deliveries +
  // cancel + release reservation). Posted ones are skipped (return territory).
  for (const o of toCancel) {
    if (!o.existingId) continue;
    const r = await cancelMarketplaceOrder(orgId, o.existingId);
    if (r.ok) {
      cancelled++;
      await db.update(salesOrders).set({ channelStatus: "Canceled" }).where(eq(salesOrders.id, o.existingId));
      await tryRecordAudit({
        orgId, userId: userId ?? null, action: "CANCEL", entityType: "SALES_ORDER",
        entityId: o.existingId, summary: `إلغاء أمر بيع (${o.externalId}) — ملغى على أمازون`,
      });
    }
  }

  // Resume parked stock-wait drafts: the order was CONFIRMED on an earlier sync and
  // its delivery parked DRAFT for lack of stock, so classifyOrders now sees it as a
  // duplicate and never re-drives the cycle. Retry them here every sync — once stock
  // arrives, fulfillOrder confirms the same DRAFT (no duplicate).
  if (canFulfill && (autoMode === "deliver" || autoMode === "invoice")) {
    const parked = await db.selectDistinct({ soId: deliveryNotes.salesOrderId, extId: salesOrders.externalOrderId })
      .from(deliveryNotes)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveryNotes.salesOrderId))
      .where(and(
        eq(deliveryNotes.organizationId, orgId),
        eq(deliveryNotes.status, "DRAFT"),
        like(deliveryNotes.notes, `${STOCK_WAIT_MARK}%`),
        eq(salesOrders.channel, ctx.channel),
        eq(salesOrders.status, "CONFIRMED"),
      ));
    for (const p of parked) {
      if (!p.soId || cycled.has(p.soId)) continue;
      const wasDrafted = stockDrafted;
      await runCycle(p.soId, p.extId ?? "");
      // Still short → it was already counted as drafted on the sync that parked it.
      if (stockDrafted > wasDrafted) stockDrafted = wasDrafted;
    }
  }

  return {
    created, transitioned, fulfilled, cancelled, stockBlocked, stockDrafted,
    skippedDuplicate: duplicates.length, skippedUnmatched: blocked.length, skippedPreGoLive, autoCreated, failed,
  };
}

// ── Inventory reconciliation ─────────────────────────────────

export type InventoryReconRow = { code: string; title: string; marketplaceQty: number; itemId: string; itemName: string; erpQty: number; diff: number };
export type InventoryReconResult = {
  totalSkus: number; totalUnits: number; matched: number; unmatched: number; withDiff: number;
  warehouseName: string; warehouseId: string; rows: InventoryReconRow[]; unmatchedSample: string[];
};

/**
 * Read-only reconciliation of a platform's warehouse against the marketplace's
 * ending on-hand per SKU. Ported from reconcilePlatformInventoryAction; applying
 * the result (a DRAFT stock adjustment) stays a separate, user-confirmed step.
 */
export async function reconcileInventory(
  orgId: string,
  platform: { defaultWarehouseId: string | null },
  inventory: MarketplaceInventory[],
): Promise<{ ok: true; result: InventoryReconResult } | { ok: false; error: string }> {
  if (!platform.defaultWarehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };
  const [wh] = await db.select({ id: warehouses.id, nameAr: warehouses.nameAr }).from(warehouses)
    .where(and(eq(warehouses.id, platform.defaultWarehouseId), eq(warehouses.organizationId, orgId))).limit(1);
  if (!wh) return { ok: false, error: "مخزن المنصة غير موجود" };

  const norms = [...new Set(inventory.map((i) => normalizeCode(i.code)).filter(Boolean))];
  const byNorm = new Map<string, string>();
  for (let i = 0; i < norms.length; i += 800) {
    const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, norms.slice(i, i + 800))));
    for (const r of rows) if (r.norm) byNorm.set(r.norm, r.itemId);
  }
  const itemRows = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr }).from(items).where(eq(items.organizationId, orgId));
  const byItemCode = new Map<string, string>(), nameById = new Map<string, string>();
  for (const it of itemRows) { byItemCode.set(normalizeCode(it.code), it.id); nameById.set(it.id, it.nameAr || it.code); }
  const matchItem = (code: string) => { const n = normalizeCode(code); return byNorm.get(n) ?? byItemCode.get(n) ?? null; };

  const rows: InventoryReconRow[] = [];
  const unmatchedSample: string[] = [];
  let matched = 0, unmatched = 0, totalUnits = 0;
  for (const inv of inventory) {
    totalUnits += inv.onHand;
    const itemId = matchItem(inv.code);
    if (!itemId) { unmatched++; if (unmatchedSample.length < 40) unmatchedSample.push(inv.code); continue; }
    matched++;
    const cur = await currentStock(orgId, itemId, wh.id);
    const erpQty = Number(cur.quantity);
    rows.push({ code: inv.code, title: inv.title, marketplaceQty: inv.onHand, itemId, itemName: nameById.get(itemId) ?? "", erpQty, diff: Math.round((inv.onHand - erpQty) * 1000) / 1000 });
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    ok: true,
    result: {
      totalSkus: inventory.length, totalUnits,
      matched, unmatched, withDiff: rows.filter((r) => Math.abs(r.diff) > 0.001).length,
      warehouseName: wh.nameAr, warehouseId: wh.id, rows: rows.slice(0, 300), unmatchedSample,
    },
  };
}

// ── Product catalog sync ─────────────────────────────────────

export type ProductSyncMode = "create" | "link";
export type ProductsResult = { total: number; linked: number; created: number; alreadyLinked: number; skippedUnmatched: number; fnskus: number };

/** Generate `count` unique internal item codes (P-00001…) that don't collide. */
async function nextItemCodes(orgId: string, count: number): Promise<string[]> {
  const existing = await db.select({ code: items.code }).from(items).where(eq(items.organizationId, orgId));
  const taken = new Set(existing.map((r) => r.code));
  let max = 0;
  for (const c of taken) { const m = /^P-(\d+)$/.exec(c); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  const out: string[] = [];
  let n = max;
  while (out.length < count) { n++; const code = `P-${String(n).padStart(5, "0")}`; if (!taken.has(code)) { out.push(code); taken.add(code); } }
  return out;
}

/**
 * Sync a marketplace's listings into the item catalog. Linking to an existing
 * item REQUIRES the listing's ASIN to already be an `ASIN` item_code on that item
 * (the customer tags their catalog with ASINs); a matched item is only enriched
 * later (fill-only), never overwritten.
 *   • `link`   — match by existing ASIN item_code only. Unmatched listings are
 *                skipped and reported (`skippedUnmatched` = "needs an ASIN code").
 *   • `create` — same ASIN match; unmatched listings become new items (auto code
 *                P-xxxxx + name + price + SKU/ASIN codes), enriched right after.
 * Idempotent: a matched item already carrying the SKU code counts as alreadyLinked.
 */
export async function ingestProducts(orgId: string, products: MarketplaceProduct[], mode: ProductSyncMode, channel = "AMAZON"): Promise<ProductsResult> {
  const result: ProductsResult = { total: products.length, linked: 0, created: 0, alreadyLinked: 0, skippedUnmatched: 0, fnskus: 0 };
  if (products.length === 0) return result;

  // Linking is keyed on the channel's own code (ASIN for Amazon, variant GID for
  // Shopify) — codeType-filtered. `known` = every existing normalized code (any
  // type), used to detect an already-attached SKU.
  const linkType = CHANNEL_CODE_TYPE[channel] ?? "ASIN";
  const [asinRows, allCodeRows] = await Promise.all([
    db.select({ itemId: itemCodes.itemId, norm: itemCodes.normalizedCode }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.codeType, linkType))),
    db.select({ norm: itemCodes.normalizedCode }).from(itemCodes).where(eq(itemCodes.organizationId, orgId)),
  ]);
  const itemByAsin = new Map<string, string>();
  for (const r of asinRows) if (r.norm && !itemByAsin.has(r.norm)) itemByAsin.set(r.norm, r.itemId);
  const known = new Set(allCodeRows.map((r) => r.norm).filter((x): x is string => !!x));

  const codeValues: { itemId: string; organizationId: string; codeType: string; code: string; normalizedCode: string }[] = [];
  const seen = new Set<string>();
  const pushCode = (itemId: string, codeType: string, code: string) => {
    const c = code.trim(); const norm = normalizeCode(c);
    if (!c || !norm) return;
    const key = `${itemId}|${codeType}|${c}`;
    if (seen.has(key)) return;
    seen.add(key);
    codeValues.push({ itemId, organizationId: orgId, codeType, code: c, normalizedCode: norm });
  };

  const plan = classifyProducts(products, itemByAsin, known, mode);
  for (const l of plan.toLink) {
    pushCode(l.itemId, "SKU", l.sku);
    if (l.fnsku) pushCode(l.itemId, "FNSKU", l.fnsku);
  }
  // Items already carrying their SKU still get the FNSKU — that is the whole point of
  // toEnrich; without it an established catalog never picks the code up.
  for (const e of plan.toEnrich) pushCode(e.itemId, "FNSKU", e.fnsku);
  result.linked = plan.toLink.length;
  result.alreadyLinked = plan.alreadyLinked;
  result.skippedUnmatched = plan.skippedUnmatched;
  const toCreate = plan.toCreate;

  const uomId = toCreate.length ? await pieceUomId(orgId) : null;
  await db.transaction(async (tx) => {
    if (toCreate.length) {
      const codes = await nextItemCodes(orgId, toCreate.length);
      // Chunk the multi-row INSERT: one giant .values([...11k]) overflows Drizzle's
      // query-node assembly (Maximum call stack) and blows Postgres's 65k param cap.
      const rows = toCreate.map((p, i) => ({ p, code: codes[i] }));
      let created = 0;
      for (const slice of chunk(rows, 500)) {
        const inserted = await tx.insert(items).values(slice.map(({ p, code }) => ({
          organizationId: orgId, code, nameAr: (p.name || p.code).trim(), uomId, sellPrice: String(round2(p.sellPrice || 0)),
        }))).returning({ id: items.id });
        inserted.forEach((it, j) => { const p = slice[j].p; pushCode(it.id, "SKU", p.code); if (p.altCode) pushCode(it.id, linkType, p.altCode); if (p.fnsku) pushCode(it.id, "FNSKU", p.fnsku); });
        created += inserted.length;
      }
      result.created = created;
    }
    for (const slice of chunk(codeValues, 500)) {
      await tx.insert(itemCodes).values(slice).onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
    }
  });

  // Offered, not necessarily inserted — the upsert ignores ones already on the item.
  result.fnskus = codeValues.filter((c) => c.codeType === "FNSKU").length;
  return result;
}

// ── Catalog enrichment (barcodes, brand/dimensions, variation families) ──

export type EnrichResult = { images: number; barcodes: number; fields: number };

/** ASIN (normalized) → itemId map for the given catalog records. */
async function itemsByAsin(orgId: string, records: CatalogRecord[]): Promise<Map<string, string>> {
  const norms = [...new Set(records.map((r) => normalizeCode(r.asin)).filter(Boolean))];
  const byAsin = new Map<string, string>(); // normalized ASIN → itemId
  for (let i = 0; i < norms.length; i += 800) {
    const rows = await db.select({ itemId: itemCodes.itemId, norm: itemCodes.normalizedCode }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, norms.slice(i, i + 800))));
    for (const r of rows) if (r.norm && !byAsin.has(r.norm)) byAsin.set(r.norm, r.itemId);
  }
  return byAsin;
}

/**
 * Fill item image / brand / weight / dimensions from catalog records (only when
 * the field is empty — never overwrites manual data) and attach barcode
 * item_codes (UPC/EAN/…). Matched by ASIN. Returns per-kind counts.
 */
export async function enrichItems(orgId: string, records: CatalogRecord[]): Promise<EnrichResult> {
  const result: EnrichResult = { images: 0, barcodes: 0, fields: 0 };
  if (records.length === 0) return result;
  const byAsin = await itemsByAsin(orgId, records);

  const codeValues: { itemId: string; organizationId: string; codeType: string; code: string; normalizedCode: string }[] = [];
  const seen = new Set<string>();
  const catCache = new Map<string, string>();
  for (const r of records) {
    const itemId = byAsin.get(normalizeCode(r.asin));
    if (!itemId) continue;

    // Category from Amazon's browse classification — set only when the item has
    // none (never overwrite a manually-chosen category). Get-or-creates the category.
    if (r.category) {
      const catId = await categoryIdByName(orgId, r.category, catCache);
      if (catId) {
        const res = await db.update(items).set({ categoryId: catId, updatedAt: new Date() })
          .where(and(eq(items.id, itemId), eq(items.organizationId, orgId), isNull(items.categoryId)))
          .returning({ id: items.id });
        if (res.length) result.fields++;
      }
    }

    // Fill empty fields only.
    const set: Record<string, string> = {};
    if (r.imageUrl) set.image = r.imageUrl;
    if (r.brand) set.brand = r.brand;
    if (r.weight) set.weight = r.weight;
    // The numeric weight is the one that does work: landed-cost allocation by weight
    // reads it, and an item without it silently contributes nothing to the split.
    if (r.weightKg != null) set.weightKg = String(r.weightKg);
    if (r.dimensions) set.dimensions = r.dimensions;
    // Update each field independently so a non-empty one doesn't block the others.
    for (const [col, val] of Object.entries(set)) {
      const c = col as "image" | "brand" | "weight" | "dimensions";
      const res = await db.update(items).set({ [c]: val, updatedAt: new Date() })
        .where(and(eq(items.id, itemId), eq(items.organizationId, orgId), or(isNull(items[c]), eq(items[c], ""))))
        .returning({ id: items.id });
      if (res.length && c === "image") result.images++;
      else if (res.length) result.fields++;
    }

    for (const idf of r.identifiers) {
      const code = idf.code.trim(); const norm = normalizeCode(code);
      const key = `${itemId}|${idf.type}|${code}`;
      if (!code || !norm || seen.has(key)) continue;
      seen.add(key);
      codeValues.push({ itemId, organizationId: orgId, codeType: idf.type, code, normalizedCode: norm });
    }
  }

  for (const slice of chunk(codeValues, 500)) {
    const inserted = await db.insert(itemCodes).values(slice)
      .onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] })
      .returning({ id: itemCodes.id });
    result.barcodes += inserted.length;
  }
  return result;
}

export type FamilyResult = { familiesLinked: number; parentsCreated: number };

/**
 * Build variation families from catalog relationships: each child ASIN with a
 * parentAsin is linked to its parent item (created if missing, since parent ASINs
 * usually aren't sellable listings). Only links a child that has no parent yet,
 * and only through the shared validateParentLink guard (one level, no cycle).
 */
export async function linkVariationFamilies(
  orgId: string,
  records: CatalogRecord[],
  fetchParentNames: (asins: string[]) => Promise<Map<string, { name?: string; imageUrl?: string }>>,
): Promise<FamilyResult> {
  const result: FamilyResult = { familiesLinked: 0, parentsCreated: 0 };
  const children = records.filter((r) => r.parentAsin && r.parentAsin !== r.asin);
  if (children.length === 0) return result;

  const byAsin = await itemsByAsin(orgId, records);
  const parentAsins = [...new Set(children.map((c) => c.parentAsin!))];
  const parentByAsin = await itemsByAsin(orgId, parentAsins.map((a) => ({ asin: a } as CatalogRecord)));

  // Create any missing parent items (fetch their names first).
  const missing = parentAsins.filter((a) => !parentByAsin.has(normalizeCode(a)));
  if (missing.length) {
    const names = await fetchParentNames(missing);
    const codes = await nextItemCodes(orgId, missing.length);
    for (let i = 0; i < missing.length; i++) {
      const asin = missing[i]; const info = names.get(asin);
      const [it] = await db.insert(items).values({
        organizationId: orgId, code: codes[i], nameAr: (info?.name || asin).trim(), image: info?.imageUrl || null,
      }).returning({ id: items.id });
      await db.insert(itemCodes).values({ itemId: it.id, organizationId: orgId, codeType: "ASIN", code: asin, normalizedCode: normalizeCode(asin) })
        .onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
      parentByAsin.set(normalizeCode(asin), it.id);
      result.parentsCreated++;
    }
  }

  for (const child of children) {
    const childId = byAsin.get(normalizeCode(child.asin));
    const parentId = parentByAsin.get(normalizeCode(child.parentAsin!));
    if (!childId || !parentId || childId === parentId) continue;

    const [childRow] = await db.select({ parentItemId: items.parentItemId }).from(items).where(and(eq(items.id, childId), eq(items.organizationId, orgId))).limit(1);
    if (!childRow || childRow.parentItemId) continue; // already in a family — don't override

    const [parentRow] = await db.select({ parentItemId: items.parentItemId }).from(items).where(and(eq(items.id, parentId), eq(items.organizationId, orgId))).limit(1);
    const [{ n: childKids }] = await db.select({ n: sql<number>`count(*)` }).from(items).where(and(eq(items.organizationId, orgId), eq(items.parentItemId, childId)));

    const err = validateParentLink({
      childId, parentId, parentExists: !!parentRow,
      parentHasParent: !!parentRow?.parentItemId, childHasChildren: Number(childKids) > 0,
    });
    if (err) continue;

    await db.update(items).set({ parentItemId: parentId, variationValue: child.variationValue ?? null, updatedAt: new Date() })
      .where(and(eq(items.id, childId), eq(items.organizationId, orgId)));
    result.familiesLinked++;
  }
  return result;
}
