import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fbaReimbursements, inventoryAuditLines, inventoryAudits, items, marketplaceSettlementTxns, platformOffers, platformReturns, salesPlatforms, warehouses } from "@/db/schema";
import { getReimbursementsForReview } from "@/lib/erp/reimbursements-core";
import { getFbaPlanInputs, getFbaSources } from "@/lib/erp/fba-plan-data";
import { planFbaShipment } from "@/lib/erp/fba-plan";

type AmazonPlatform = {
  code: string;
  name: string;
  fbaWarehouseId: string | null;
  fbaWarehouseName: string | null;
};

/** Read an Amazon platform only inside the caller's already-established org scope. */
export async function getAmazonPlatform(orgId: string, code: string): Promise<AmazonPlatform | null> {
  const [platform] = await db
    .select({
      code: salesPlatforms.code,
      name: salesPlatforms.name,
      integrationType: salesPlatforms.integrationType,
      fbaWarehouseId: salesPlatforms.defaultWarehouseId,
      fbaWarehouseName: warehouses.nameAr,
    })
    .from(salesPlatforms)
    .leftJoin(warehouses, eq(warehouses.id, salesPlatforms.defaultWarehouseId))
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code.toUpperCase())))
    .limit(1);
  if (!platform || platform.integrationType !== "amazon") return null;
  return platform;
}

/** Same Buy Box read model as the web workspace, serialized for the native client. */
export async function getMobileBuyBox(orgId: string, platform: Pick<AmazonPlatform, "code">) {
  const rows = await db
    .select({
      itemId: platformOffers.itemId,
      name: items.nameAr,
      sku: platformOffers.sku,
      myPrice: platformOffers.myPrice,
      buyBoxPrice: platformOffers.buyBoxPrice,
      lowestPrice: platformOffers.lowestPrice,
      offerCount: platformOffers.offerCount,
      isWinner: platformOffers.isWinner,
      lostSince: platformOffers.lostSince,
    })
    .from(platformOffers)
    .innerJoin(items, eq(items.id, platformOffers.itemId))
    .where(and(eq(platformOffers.organizationId, orgId), eq(platformOffers.channel, platform.code)))
    .orderBy(
      sql`case when ${platformOffers.isWinner} = false then 0 when ${platformOffers.isWinner} is null then 1 else 2 end`,
      asc(platformOffers.lostSince),
      asc(items.nameAr),
    );
  const [{ checked }] = await db
    .select({ checked: max(platformOffers.checkedAt) })
    .from(platformOffers)
    .where(and(eq(platformOffers.organizationId, orgId), eq(platformOffers.channel, platform.code)));

  const normalized = rows.map((row) => ({
    ...row,
    name: row.name ?? row.sku,
    myPrice: row.myPrice == null ? null : Number(row.myPrice),
    buyBoxPrice: row.buyBoxPrice == null ? null : Number(row.buyBoxPrice),
    lowestPrice: row.lowestPrice == null ? null : Number(row.lowestPrice),
    lostSince: row.lostSince?.toISOString() ?? null,
  }));
  const lost = normalized.filter((row) => row.isWinner === false).length;
  const won = normalized.filter((row) => row.isWinner === true).length;
  return {
    checkedAt: checked?.toISOString() ?? null,
    summary: { lost, won, unavailable: normalized.length - lost - won },
    rows: normalized,
  };
}

const clampDays = (value: string | null, fallback: number, min: number, maxValue: number) => {
  const parsed = Math.round(Number(value));
  return value && Number.isFinite(parsed) ? Math.min(maxValue, Math.max(min, parsed)) : fallback;
};

/** Same FBA calculation as the web page. Nothing is posted or transferred by this read model. */
export async function getMobileFbaPlan(orgId: string, platform: AmazonPlatform, search: URLSearchParams) {
  const windowDays = clampDays(search.get("window"), 30, 7, 180);
  const transitDays = clampDays(search.get("transit"), 14, 0, 90);
  const coverDays = clampDays(search.get("cover"), 30, 7, 180);
  if (!platform.fbaWarehouseId) {
    return {
      state: "setup_required" as const,
      reason: "fba_warehouse_required",
      platform,
      sources: [],
      params: { windowDays, transitDays, coverDays },
      auditAt: null,
      rows: [],
    };
  }

  const sources = await getFbaSources(orgId);
  const source = sources.find((warehouse) => warehouse.id === search.get("source")) ?? sources[0];
  if (!source) {
    return {
      state: "setup_required" as const,
      reason: "source_warehouse_required",
      platform,
      sources,
      params: { windowDays, transitDays, coverDays },
      auditAt: null,
      rows: [],
    };
  }

  const { rows, auditAt } = await getFbaPlanInputs(orgId, platform.fbaWarehouseId, source.id, windowDays);
  return {
    state: "ready" as const,
    reason: null,
    platform,
    sources,
    source,
    params: { windowDays, transitDays, coverDays },
    auditAt: auditAt?.toISOString() ?? null,
    rows: planFbaShipment(rows, { windowDays, transitDays, coverDays }),
  };
}

/** A compact, read-only daily Amazon health board. Inventory-only checks are omitted
 * when the caller lacks inventory.view, exactly as the web health page does. */
export async function getMobileAmazonHealth(orgId: string, platform: AmazonPlatform, canViewInventory: boolean) {
  const count = (query: Promise<{ rows: { n: number }[] }>) => query.then((result) => Number(result.rows[0]?.n ?? 0));
  const [unmatched, failedSyncs, unposted, returns, reimbursements, lostBuyBox, audit, fbaNeeds] = await Promise.all([
    count(db.execute(sql`SELECT count(*)::int n FROM unmatched_orders WHERE organization_id = ${orgId} AND channel = ${platform.code} AND status = 'PENDING'`)),
    count(db.execute(sql`SELECT count(*)::int n FROM (
      SELECT DISTINCT ON (kind) status FROM sync_runs
      WHERE organization_id = ${orgId} AND provider = 'amazon' AND status <> 'RUNNING' AND started_at > now() - interval '7 days'
      ORDER BY kind, started_at DESC) recent WHERE status = 'FAILED'`)),
    count(db.execute(sql`SELECT count(*)::int n FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND channel = ${platform.code} AND status = 'Released' AND journal_entry_id IS NULL`)),
    count(db.execute(sql`SELECT count(*)::int n FROM sales_returns WHERE organization_id = ${orgId} AND channel = ${platform.code} AND status = 'DRAFT'`)),
    count(db.execute(sql`SELECT count(*)::int n FROM fba_reimbursements WHERE organization_id = ${orgId} AND status = 'PENDING'`)),
    count(db.execute(sql`SELECT count(*)::int n FROM platform_offers WHERE organization_id = ${orgId} AND channel = ${platform.code} AND is_winner = false`)),
    canViewInventory
      ? db.select({ withDiff: inventoryAudits.withDiff, lost: inventoryAudits.lost, damaged: inventoryAudits.damaged, at: inventoryAudits.createdAt })
        .from(inventoryAudits)
        .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.provider, "amazon"), eq(inventoryAudits.status, "OK")))
        .orderBy(desc(inventoryAudits.createdAt)).limit(1)
      : Promise.resolve([]),
    canViewInventory && platform.fbaWarehouseId
      ? (async () => {
        const [source] = await getFbaSources(orgId);
        if (!source) return 0;
        const inputs = await getFbaPlanInputs(orgId, platform.fbaWarehouseId!, source.id, 30);
        return planFbaShipment(inputs.rows, { windowDays: 30, transitDays: 14, coverDays: 30 })
          .filter((row) => row.status === "out" || row.status === "critical").length;
      })()
      : Promise.resolve(0),
  ]);
  const latestAudit = audit[0];
  const checks = [
    { key: "unmatched", title: "طلبات غير مرتبطة", count: unmatched, detail: "طلبات Amazon محتاجة ربط SKU بصنف." },
    { key: "sync", title: "مزامنات متوقفة", count: failedSyncs, detail: "آخر محاولة لنوع مزامنة فشلت خلال 7 أيام." },
    { key: "settlements", title: "تسويات غير مرحّلة", count: unposted, detail: "حركات محررة من Amazon لم تُرحّل للحسابات بعد." },
    ...(canViewInventory ? [{ key: "fba", title: "شحن FBA مطلوب", count: fbaNeeds, detail: "أصناف قد تنفد قبل وصول شحنة جديدة." }] : []),
    { key: "buy_box", title: "Buy Box مفقود", count: lostBuyBox, detail: "بائع آخر يملك الـBuy Box في منتجات مراقبة." },
    { key: "returns", title: "مرتجعات معلقة", count: returns, detail: "مرتجعات Amazon في مسودة وتحتاج قرارًا." },
    { key: "reimbursements", title: "تعويضات معلقة", count: reimbursements, detail: "تعويضات Amazon لم تُسجّل بعد." },
    ...(canViewInventory ? [{ key: "audit", title: "فروق تدقيق FBA", count: latestAudit?.withDiff ?? 1, detail: latestAudit ? "فرق بين رصيد Amazon والنظام." : "لا يوجد تدقيق Amazon مكتمل بعد." }] : []),
  ];
  return { checkedAt: new Date().toISOString(), openCount: checks.filter((check) => check.count > 0).length, checks };
}

/** The native read model for Amazon money and after-sales work. Posting is deliberately
 * kept separate: every generated document remains a Draft for an accountant to review. */
export async function getMobileAmazonOperations(orgId: string, platform: AmazonPlatform) {
  const [settlements, returns, reimbursements] = await Promise.all([
    db.select({
      id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type, orderId: marketplaceSettlementTxns.orderId,
      sku: marketplaceSettlementTxns.sku, status: marketplaceSettlementTxns.status, releaseDate: marketplaceSettlementTxns.releaseDate,
      total: marketplaceSettlementTxns.total, sellingFees: marketplaceSettlementTxns.sellingFees,
      fbaFees: marketplaceSettlementTxns.fbaFees, otherFees: marketplaceSettlementTxns.otherTransactionFees,
      posted: marketplaceSettlementTxns.journalEntryId,
    }).from(marketplaceSettlementTxns)
      .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.channel, platform.code)))
      .orderBy(desc(marketplaceSettlementTxns.releaseDate), desc(marketplaceSettlementTxns.createdAt)).limit(100),
    db.select({
      id: platformReturns.id, orderId: platformReturns.orderId, sku: platformReturns.sku, asin: platformReturns.asin,
      quantity: platformReturns.quantity, returnDate: platformReturns.returnDate, disposition: platformReturns.disposition,
      reason: platformReturns.reason, status: platformReturns.status, salesReturnId: platformReturns.salesReturnId,
    }).from(platformReturns)
      .where(and(eq(platformReturns.organizationId, orgId), eq(platformReturns.channel, platform.code)))
      .orderBy(desc(platformReturns.returnDate), desc(platformReturns.createdAt)).limit(100),
    getReimbursementsForReview(orgId),
  ]);
  return {
    settlements: settlements.map((row) => ({
      ...row, total: Number(row.total), sellingFees: Number(row.sellingFees), fbaFees: Number(row.fbaFees), otherFees: Number(row.otherFees),
      releaseDate: row.releaseDate?.toISOString() ?? null, posted: !!row.posted,
    })),
    returns: returns.map((row) => ({ ...row, quantity: Number(row.quantity), returnDate: row.returnDate?.toISOString() ?? null })),
    reimbursements,
  };
}

/** Latest read-only Amazon FBA audit, ordered so real stock problems appear first. */
export async function getMobileFbaReconciliation(orgId: string) {
  const [audit] = await db.select({
    id: inventoryAudits.id, status: inventoryAudits.status, totalSkus: inventoryAudits.totalSkus,
    matched: inventoryAudits.matched, unmatched: inventoryAudits.unmatched, withDiff: inventoryAudits.withDiff,
    lost: inventoryAudits.lost, damaged: inventoryAudits.damaged, error: inventoryAudits.error,
    createdAt: inventoryAudits.createdAt, finishedAt: inventoryAudits.finishedAt,
  }).from(inventoryAudits)
    .where(and(eq(inventoryAudits.organizationId, orgId), eq(inventoryAudits.provider, "amazon")))
    .orderBy(desc(inventoryAudits.createdAt)).limit(1);
  if (!audit) return { audit: null, lines: [] };
  const lines = await db.select({
    id: inventoryAuditLines.id, itemId: inventoryAuditLines.itemId, code: inventoryAuditLines.code, asin: inventoryAuditLines.asin,
    itemName: inventoryAuditLines.itemName, erpQty: inventoryAuditLines.erpQty, amazonTotal: inventoryAuditLines.amazonTotal,
    available: inventoryAuditLines.available, inbound: inventoryAuditLines.inbound, damaged: inventoryAuditLines.damaged,
    diff: inventoryAuditLines.diff, status: inventoryAuditLines.status,
  }).from(inventoryAuditLines)
    .where(and(eq(inventoryAuditLines.organizationId, orgId), eq(inventoryAuditLines.auditId, audit.id)))
    .orderBy(sql`CASE ${inventoryAuditLines.status} WHEN 'LOST' THEN 0 WHEN 'DAMAGED' THEN 1 WHEN 'FOUND' THEN 2 WHEN 'UNMATCHED' THEN 3 ELSE 4 END`, desc(sql`abs(${inventoryAuditLines.diff})`))
    .limit(200);
  return {
    audit: { ...audit, createdAt: audit.createdAt.toISOString(), finishedAt: audit.finishedAt?.toISOString() ?? null },
    lines: lines.map((line) => ({ ...line, erpQty: Number(line.erpQty), diff: Number(line.diff) })),
  };
}
