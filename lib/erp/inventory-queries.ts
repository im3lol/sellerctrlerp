import { and, or, eq, ilike, inArray, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes, warehouses } from "@/db/schema";
import { getAvailability } from "@/lib/erp/availability";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

/** Active warehouses for the org (for mobile pickers). */
export async function listWarehouses(orgId: string): Promise<{ id: string; name: string }[]> {
  const rows = await db.select({ id: warehouses.id, name: warehouses.nameAr })
    .from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)))
    .orderBy(asc(warehouses.nameAr));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

/** Canonical form for scan/exact match: uppercase, alphanumerics only. */
export function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Org-scoped item search core — no auth (callers supply orgId after their own
 * check). Shared by the web action ({@link searchItemsAction}) and the mobile
 * API. Searches internal code, Arabic/English name, or any linked external code
 * (SKU/ASIN/UPC/EAN/barcode), returning top matches with on-hand + their codes.
 */
export async function searchItems(orgId: string, query: string): Promise<ItemSearchResult[]> {
  const q = query.trim();
  if (q.length < 1) return [];
  const norm = normalizeCode(q);

  const codeMatches = norm
    ? await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), ilike(itemCodes.normalizedCode, `%${norm}%`)))
        .limit(50)
    : [];
  const codeItemIds = [...new Set(codeMatches.map((c) => c.itemId))];

  const conds = [
    ilike(items.code, `%${q}%`),
    ilike(items.nameAr, `%${q}%`),
  ];
  if (codeItemIds.length) conds.push(inArray(items.id, codeItemIds));

  const rows = await db
    .select({ id: items.id, code: items.code, nameAr: items.nameAr, sellPrice: items.sellPrice, image: items.image })
    .from(items)
    .where(and(eq(items.organizationId, orgId), eq(items.isActive, true), or(...conds)))
    .limit(15);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const avail = await getAvailability(orgId, ids);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  const stockRows = await db.execute<{ item_id: string; qty: string }>(sql`
    SELECT item_id, COALESCE(SUM(bal), 0) AS qty FROM (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity AS bal
      FROM stock_movements
      WHERE organization_id = ${orgId} AND item_id IN (${idList})
      ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
    ) t GROUP BY item_id`);
  const stockBy = new Map((stockRows.rows as { item_id: string; qty: string }[]).map((r) => [r.item_id, Number(r.qty)]));

  const codeRows = await db.select({ itemId: itemCodes.itemId, type: itemCodes.codeType, code: itemCodes.code })
    .from(itemCodes).where(inArray(itemCodes.itemId, ids));
  const codesBy = new Map<string, { type: string; code: string }[]>();
  for (const c of codeRows) {
    const list = codesBy.get(c.itemId) ?? [];
    list.push({ type: c.type, code: c.code });
    codesBy.set(c.itemId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.nameAr || r.code,
    sellPrice: Number(r.sellPrice),
    image: r.image,
    stock: stockBy.get(r.id) ?? 0,
    reserved: avail.get(r.id)?.reserved ?? 0,
    available: avail.get(r.id)?.available ?? (stockBy.get(r.id) ?? 0),
    codes: codesBy.get(r.id) ?? [],
  }));
}

/** Exact barcode/SKU lookup (scan) — the single matching item or null. */
export async function scanItem(orgId: string, code: string): Promise<ItemSearchResult | null> {
  const norm = normalizeCode(code);
  if (!norm) return null;

  const [hit] = await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
    .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.normalizedCode, norm))).limit(1);

  let itemId = hit?.itemId;
  if (!itemId) {
    const [byCode] = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.organizationId, orgId), sql`upper(${items.code}) = ${norm}`)).limit(1);
    itemId = byCode?.id;
  }
  if (!itemId) return null;

  const results = await searchItems(orgId, code);
  return results.find((r) => r.id === itemId) ?? null;
}
