import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes, salesOrders, salesOrderLines, warehouses } from "@/db/schema";
import { round2 } from "@/lib/erp/money";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { tryRecordAudit } from "@/lib/erp/audit";
import { confirmSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { fulfillOrder, cancelMarketplaceOrder } from "@/lib/erp/fulfillment";
import { currentStock } from "@/lib/erp/inventory";
import { classifyOrders, classifyProducts, type PreviewOrder, type OrdersPreview } from "./classify";
import { validateParentLink } from "@/lib/erp/item-family-core";
import type { MarketplaceOrder, MarketplaceInventory, MarketplaceProduct } from "./dto";
import type { CatalogRecord } from "./connector";

export { classifyOrders };
export type { OrdersPreview };
export type { MatchedLine } from "./classify";

/**
 * Vendor-neutral write layer. Connectors and the manual-import actions both hand
 * their parsed data here as DTOs, so all order/inventory logic (matching, the
 * DRAFT→fulfil cycle, reconciliation) lives once and the ERP never knows the
 * source. Ported from the former Amazon-specific actions with no behaviour change.
 */
export type PlatformCtx = { platformId: string | null; customerId: string; warehouseId: string | null; channel: string; label: string; autoInvoice?: boolean };

export type IngestResult = {
  created: number;
  transitioned: number;
  fulfilled: number;
  cancelled: number;
  stockBlocked: { externalId: string; reason: string }[];
  skippedDuplicate: number;
  skippedUnmatched: number;
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
  const byNorm = new Map<string, string>();
  for (let i = 0; i < normList.length; i += 800) {
    const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId })
      .from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, normList.slice(i, i + 800))));
    for (const r of rows) if (r.norm) byNorm.set(r.norm, r.itemId);
  }

  const itemRows = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
    .from(items).where(eq(items.organizationId, orgId));
  const nameById = new Map<string, string>();
  const byItemCode = new Map<string, string>();
  for (const it of itemRows) {
    nameById.set(it.id, it.nameAr || it.code);
    byItemCode.set(normalizeCode(it.code), it.id);
  }

  return (code: string, altCode?: string): { itemId: string | null; itemName: string | null } => {
    for (const c of [code, altCode]) {
      const n = normalizeCode(c || "");
      if (!n) continue;
      const id = byNorm.get(n) ?? byItemCode.get(n);
      if (id) return { itemId: id, itemName: nameById.get(id) ?? null };
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
  const existing = await existingOrders(orgId, ctx.channel);
  const { toCreate, transitions, toCancel, duplicates, blocked } = classifyOrders(orders, resolve, existing);

  let created = 0, transitioned = 0, fulfilled = 0, cancelled = 0, failed = 0;
  const stockBlocked: { externalId: string; reason: string }[] = [];

  const insertOrder = async (o: PreviewOrder, status: string): Promise<string | null> => {
    const d = new Date(o.date || Date.now());
    try {
      return await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, orgId, "SO", d.getFullYear());
        const [so] = await tx.insert(salesOrders).values({
          organizationId: orgId, number, customerId: ctx.customerId, date: d, status,
          subtotal: String(o.subtotal), shippingAmount: String(o.shippingTotal),
          totalAmount: String(round2(o.subtotal + o.shippingTotal)),
          channel: ctx.channel, platformId: ctx.platformId, externalOrderId: o.externalId, notes: `${ctx.label} ${o.externalId}`,
        }).returning({ id: salesOrders.id, number: salesOrders.number });
        await tx.insert(salesOrderLines).values(o.lines.map((l) => ({
          salesOrderId: so.id, itemId: l.itemId!, warehouseId: ctx.warehouseId,
          quantity: String(l.qty), unitPrice: String(l.unitPrice), totalAmount: String(l.lineTotal),
        })));
        if (userId) await tryRecordAudit({
          orgId, userId, action: "CREATE", entityType: "SALES_ORDER",
          entityId: so.id, entityNumber: so.number,
          summary: `استيراد أمر بيع ${so.number} من ${ctx.label} (${o.externalId})`, metadata: { channel: ctx.channel, externalOrderId: o.externalId, total: o.total },
        });
        return so.id;
      });
    } catch {
      return null;
    }
  };

  const runCycle = async (orderId: string, extId: string) => {
    const f = await fulfillOrder(orgId, orderId, { invoice: ctx.autoInvoice ?? true });
    if (f.ok) { if (!f.noop) fulfilled++; }
    else if (f.blocked) stockBlocked.push({ externalId: extId, reason: f.error });
    else failed++;
  };

  for (const o of toCreate) {
    const shipped = o.status === "Shipped";
    const id = await insertOrder(o, shipped ? "CONFIRMED" : "DRAFT");
    if (!id) { failed++; continue; }
    created++;
    if (shipped) await runCycle(id, o.externalId);
  }

  for (const o of transitions) {
    if (!o.existingId) continue;
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
    if (r.ok) cancelled++;
  }

  return {
    created, transitioned, fulfilled, cancelled, stockBlocked,
    skippedDuplicate: duplicates.length, skippedUnmatched: blocked.length, failed,
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
export type ProductsResult = { total: number; linked: number; created: number; alreadyLinked: number; skippedUnmatched: number };

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
export async function ingestProducts(orgId: string, products: MarketplaceProduct[], mode: ProductSyncMode): Promise<ProductsResult> {
  const result: ProductsResult = { total: products.length, linked: 0, created: 0, alreadyLinked: 0, skippedUnmatched: 0 };
  if (products.length === 0) return result;

  // Linking is keyed on ASIN item_codes ONLY (codeType-filtered). `known` = every
  // existing normalized code (any type), used to detect an already-attached SKU.
  const [asinRows, allCodeRows] = await Promise.all([
    db.select({ itemId: itemCodes.itemId, norm: itemCodes.normalizedCode }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.codeType, "ASIN"))),
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
  for (const l of plan.toLink) pushCode(l.itemId, "SKU", l.sku);
  result.linked = plan.toLink.length;
  result.alreadyLinked = plan.alreadyLinked;
  result.skippedUnmatched = plan.skippedUnmatched;
  const toCreate = plan.toCreate;

  await db.transaction(async (tx) => {
    if (toCreate.length) {
      const codes = await nextItemCodes(orgId, toCreate.length);
      const inserted = await tx.insert(items).values(toCreate.map((p, i) => ({
        organizationId: orgId, code: codes[i], nameAr: (p.name || p.code).trim(), sellPrice: String(round2(p.sellPrice || 0)),
      }))).returning({ id: items.id });
      inserted.forEach((it, i) => { pushCode(it.id, "SKU", toCreate[i].code); if (toCreate[i].altCode) pushCode(it.id, "ASIN", toCreate[i].altCode!); });
      result.created = inserted.length;
    }
    if (codeValues.length) {
      await tx.insert(itemCodes).values(codeValues).onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] });
    }
  });

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
  for (const r of records) {
    const itemId = byAsin.get(normalizeCode(r.asin));
    if (!itemId) continue;

    // Fill empty fields only.
    const set: Record<string, string> = {};
    if (r.imageUrl) set.image = r.imageUrl;
    if (r.brand) set.brand = r.brand;
    if (r.weight) set.weight = r.weight;
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

  if (codeValues.length) {
    const inserted = await db.insert(itemCodes).values(codeValues)
      .onConflictDoNothing({ target: [itemCodes.itemId, itemCodes.codeType, itemCodes.code] })
      .returning({ id: itemCodes.id });
    result.barcodes = inserted.length;
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
