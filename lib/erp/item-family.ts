import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";

export type FamilyMember = {
  id: string;
  code: string;
  name: string;
  variationValue: string | null;
  sellPrice: number;
  stock: number; // on-hand
  extCode: { type: string; value: string } | null; // primary external code, any platform (ASIN/SKU/NOON/…)
  isHead: boolean; // the parent of the family
};

/**
 * Resolve the variation family for an item. The family head is the item's parent
 * (if it's a child) or the item itself (if it's a parent). Returns null when the
 * item is standalone (no parent and no children) — nothing to show.
 */
export async function getItemFamily(
  orgId: string,
  item: { id: string; parentItemId: string | null },
): Promise<{ head: FamilyMember; children: FamilyMember[] } | null> {
  const headId = item.parentItemId ?? item.id;

  const rows = await db
    .select({ id: items.id, code: items.code, nameAr: items.nameAr, nameEn: items.nameEn, sellPrice: items.sellPrice, variationValue: items.variationValue, parentItemId: items.parentItemId })
    .from(items)
    .where(and(eq(items.organizationId, orgId), sql`(${items.id} = ${headId} OR ${items.parentItemId} = ${headId})`));

  const head = rows.find((r) => r.id === headId);
  const childRows = rows.filter((r) => r.parentItemId === headId);
  if (!head || childRows.length === 0) return null; // standalone item — not a family

  const ids = rows.map((r) => r.id);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const stockRows = (await db.execute<{ item_id: string; qty: string }>(sql`
    SELECT item_id, COALESCE(SUM(bal), 0) AS qty FROM (
      SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity AS bal
      FROM stock_movements WHERE organization_id = ${orgId} AND item_id IN (${idList})
      ORDER BY item_id, warehouse_id, created_at DESC, id DESC
    ) t GROUP BY item_id`)).rows as { item_id: string; qty: string }[];
  const stockBy = new Map(stockRows.map((r) => [r.item_id, Number(r.qty)]));

  // A representative external code per item — primary if flagged, else the first
  // one, of ANY type. Platform-agnostic (ASIN / SKU / NOON / barcode / …).
  const codeRows = await db.select({ itemId: itemCodes.itemId, type: itemCodes.codeType, code: itemCodes.code, isPrimary: itemCodes.isPrimary })
    .from(itemCodes).where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.itemId, ids)));
  const codeBy = new Map<string, { type: string; value: string }>();
  for (const c of codeRows) {
    if (!codeBy.has(c.itemId) || c.isPrimary) codeBy.set(c.itemId, { type: c.type, value: c.code });
  }

  const toMember = (r: (typeof rows)[number]): FamilyMember => ({
    id: r.id,
    code: r.code,
    name: r.nameAr || r.nameEn || r.code,
    variationValue: r.variationValue,
    sellPrice: Number(r.sellPrice),
    stock: stockBy.get(r.id) ?? 0,
    extCode: codeBy.get(r.id) ?? null,
    isHead: r.id === headId,
  });

  // Children sorted by code for a stable, readable order.
  const children = childRows.map(toMember).sort((a, b) => a.code.localeCompare(b.code));
  return { head: toMember(head), children };
}
