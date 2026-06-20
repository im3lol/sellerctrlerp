"use server";

import { and, or, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";

export type ItemSearchResult = {
  id: string;
  code: string;
  name: string;
  sellPrice: number;
  image: string | null;
  stock: number;
  codes: { type: string; code: string }[];
};

/** Canonical form for scan/exact match: uppercase, alphanumerics only. */
function normalizeCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Search active-org items by internal code, Arabic/English name, or any linked
 * external code (SKU/ASIN/UPC/EAN/barcode/marketplace). Returns top matches with
 * current on-hand stock and their codes — feeds the item combobox + barcode scan.
 */
export async function searchItemsAction(query: string): Promise<ItemSearchResult[]> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return [];
  const q = query.trim();
  if (q.length < 1) return [];
  const norm = normalizeCode(q);

  // Candidate item ids whose external code matches (normalized contains).
  const codeMatches = norm
    ? await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, auth.orgId), ilike(itemCodes.normalizedCode, `%${norm}%`)))
        .limit(50)
    : [];
  const codeItemIds = [...new Set(codeMatches.map((c) => c.itemId))];

  const conds = [
    ilike(items.code, `%${q}%`),
    ilike(items.nameAr, `%${q}%`),
    ilike(items.nameEn, `%${q}%`),
  ];
  if (codeItemIds.length) conds.push(inArray(items.id, codeItemIds));

  const rows = await db
    .select({ id: items.id, code: items.code, nameAr: items.nameAr, nameEn: items.nameEn, sellPrice: items.sellPrice, image: items.image })
    .from(items)
    .where(and(eq(items.organizationId, auth.orgId), eq(items.isActive, true), or(...conds)))
    .limit(15);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);

  // On-hand stock = sum of the latest balance per warehouse for each item.
  const stockRows = await db.execute<{ item_id: string; qty: string }>(sql`
    SELECT item_id, COALESCE(SUM(bal), 0) AS qty FROM (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity AS bal
      FROM stock_movements
      WHERE organization_id = ${auth.orgId} AND item_id IN (${idList})
      ORDER BY item_id, warehouse_id, created_at DESC, id DESC
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
    name: r.nameAr || r.nameEn || r.code,
    sellPrice: Number(r.sellPrice),
    image: r.image,
    stock: stockBy.get(r.id) ?? 0,
    codes: codesBy.get(r.id) ?? [],
  }));
}

/** Exact barcode/SKU lookup (scan) — returns the single matching item or null. */
export async function scanItemAction(code: string): Promise<ItemSearchResult | null> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return null;
  const norm = normalizeCode(code);
  if (!norm) return null;

  const [hit] = await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
    .where(and(eq(itemCodes.organizationId, auth.orgId), eq(itemCodes.normalizedCode, norm))).limit(1);

  let itemId = hit?.itemId;
  if (!itemId) {
    // Fall back to the item's internal code.
    const [byCode] = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.organizationId, auth.orgId), sql`upper(${items.code}) = ${norm}`)).limit(1);
    itemId = byCode?.id;
  }
  if (!itemId) return null;

  const results = await searchItemsAction(code);
  return results.find((r) => r.id === itemId) ?? null;
}
