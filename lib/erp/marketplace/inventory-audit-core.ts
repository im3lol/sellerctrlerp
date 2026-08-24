import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { itemCodes, items, inventoryAudits, inventoryAuditLines } from "@/db/schema";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { chunk } from "@/lib/erp/chunk";
import { classifyAudit, type AuditRow } from "./inventory-audit";
import type { MarketplaceInventoryDetail } from "./dto";
import type { SyncPrep } from "./sync-core";

export type AuditOutcome = { auditId: string; totalSkus: number; matched: number; unmatched: number; withDiff: number; lost: number; damaged: number };

/**
 * Read-only Inventory Audit: pull Amazon's FBA breakdown, match to ERP items, read
 * the ERP on-hand in the platform's warehouse, classify each SKU, and store a
 * snapshot (inventory_audits + lines). NEVER changes stock — it detects + explains
 * differences. Slow (pulls the whole FBA catalog) → run from a background worker.
 */
export async function runInventoryAudit(p: SyncPrep): Promise<AuditOutcome> {
  if (!p.connector.fetchInventoryDetail) throw new Error("المنصة لا تدعم مخزون FBA");
  const warehouseId = p.ctx.warehouseId;
  const marketplace = p.cred.marketplaceId ?? null;

  const detail = await p.connector.fetchInventoryDetail(p.cred); // slow, unscoped
  // Keep SKUs that matter: any owned units, or any flagged/inbound state.
  const relevant = detail.filter((d) =>
    d.total > 0 || d.unfulfillableTotal > 0 || d.researching > 0 || (d.inboundWorking + d.inboundShipped + d.inboundReceiving) > 0);
  if (!relevant.length) throw new Error("لا يوجد مخزون FBA للمطابقة");

  return withOrgScope(p.orgId, false, async () => {
    // Match SKU/ASIN → ERP itemId.
    const norms = [...new Set(relevant.flatMap((d) => [normalizeCode(d.code), d.asin ? normalizeCode(d.asin) : ""]).filter(Boolean))];
    const byNorm = new Map<string, string>();
    for (const b of chunk(norms, 800)) {
      const rows = await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, p.orgId), inArray(itemCodes.normalizedCode, b)));
      for (const r of rows) if (r.norm && !byNorm.has(r.norm)) byNorm.set(r.norm, r.itemId);
    }
    const matchItem = (d: MarketplaceInventoryDetail): string | null =>
      byNorm.get(normalizeCode(d.code)) ?? (d.asin ? byNorm.get(normalizeCode(d.asin)) ?? null : null) ?? null;

    // Item names + ERP on-hand in the FBA warehouse (latest running balance per item).
    const itemIds = [...new Set(relevant.map(matchItem).filter((x): x is string => !!x))];
    const nameById = new Map<string, string>();
    const erpQtyById = new Map<string, number>();
    for (const b of chunk(itemIds, 800)) {
      const rows = await db.select({ id: items.id, name: items.nameAr }).from(items)
        .where(and(eq(items.organizationId, p.orgId), inArray(items.id, b)));
      for (const r of rows) nameById.set(r.id, r.name ?? "");
    }
    if (warehouseId) {
      // Read every latest balance in the platform's warehouse in one query — no giant
      // IN/ANY list (that warehouse holds far fewer items than the FBA catalog).
      const rows = await db.execute<{ item_id: string; bq: string }>(sql`
        SELECT DISTINCT ON (item_id) item_id, balance_quantity AS bq
        FROM stock_movements
        WHERE organization_id = ${p.orgId} AND warehouse_id = ${warehouseId}
        ORDER BY item_id, created_at DESC, number DESC`);
      for (const r of rows.rows ?? []) erpQtyById.set(r.item_id, Number(r.bq));
    }

    // Classify each SKU.
    const auditRows: AuditRow[] = relevant.map((d) => {
      const itemId = matchItem(d);
      const erpQty = itemId ? erpQtyById.get(itemId) ?? 0 : 0;
      const row = classifyAudit(d, itemId, erpQty);
      return itemId ? { ...row, title: nameById.get(itemId) || row.title } : row;
    });

    const matched = auditRows.filter((r) => r.itemId).length;
    const unmatched = auditRows.length - matched;
    const withDiff = auditRows.filter((r) => Math.abs(r.diff) > 0.001).length;
    const lost = auditRows.filter((r) => r.status === "LOST").length;
    const damaged = auditRows.filter((r) => r.status === "DAMAGED").length;

    const [audit] = await db.insert(inventoryAudits).values({
      organizationId: p.orgId, provider: p.provider, marketplace, warehouseId: warehouseId ?? null,
      status: "OK", totalSkus: auditRows.length, matched, unmatched, withDiff, lost, damaged, finishedAt: new Date(),
    }).returning({ id: inventoryAudits.id });

    for (const b of chunk(auditRows, 500)) {
      await db.insert(inventoryAuditLines).values(b.map((r) => ({
        auditId: audit.id, organizationId: p.orgId, code: r.code, asin: r.asin ?? null,
        itemId: r.itemId, itemName: r.title || null,
        erpQty: String(r.erpQty), amazonTotal: r.amazonTotal, available: r.available, reserved: r.reserved,
        inbound: r.inbound, damaged: r.damaged, expired: r.expired, researching: r.researching, diff: String(r.diff), status: r.status,
      })));
    }

    return { auditId: audit.id, totalSkus: auditRows.length, matched, unmatched, withDiff, lost, damaged };
  });
}
