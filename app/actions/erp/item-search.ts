"use server";

import { withOrgScope } from "@/lib/db-scope";
import { authorizeErp } from "@/lib/erp/action-auth";
import { searchItems, scanItem } from "@/lib/erp/inventory-queries";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { normalizeCode } from "@/lib/erp/item-codes";

export type PasteItem = { id: string; code: string; name: string; sellPrice: number; image: string | null };

/** Exact, tenant-scoped batch lookup. Ambiguous aliases never silently select an item. */
export async function resolvePasteItemsAction(codes: string[]): Promise<{ code: string; item?: PasteItem; ambiguous?: boolean }[]> {
  if (!Array.isArray(codes) || codes.length > 300 || codes.some(c => typeof c !== "string" || !c.trim() || c.length > 200)) throw new Error("راجع تنسيق الخلايا المنسوخة");
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) throw new Error("تعذّر التحقق من صلاحية عرض الأصناف");
  if (!codes.length) return [];
  return withOrgScope(auth.orgId, false, async () => {
    const norms = [...new Set(codes.map(normalizeCode))].filter(Boolean);
    const aliases = norms.length ? await db.select({ itemId: itemCodes.itemId, norm: itemCodes.normalizedCode }).from(itemCodes)
      .where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.normalizedCode, norms))) : [];
    const ids = [...new Set(aliases.map(a => a.itemId))];
    const normalizedInternal = sql`regexp_replace(upper(${items.code}), '[^A-Z0-9]', '', 'g')`;
    const found = await db.select({ id: items.id, code: items.code, name: items.nameAr, sellPrice: items.sellPrice, image: items.image }).from(items)
      .where(and(eq(items.organizationId, auth.orgId), eq(items.isActive, true), or(
        norms.length ? inArray(normalizedInternal, norms) : sql`false`,
        ids.length ? inArray(items.id, ids) : sql`false`,
      )));
    return codes.map(code => {
      const norm = normalizeCode(code);
      const matches = found.filter(it => normalizeCode(it.code) === norm || aliases.some(a => a.itemId === it.id && a.norm === norm));
      if (matches.length !== 1) return { code, ambiguous: matches.length > 1 };
      const it = matches[0];
      return { code, item: { ...it, name: it.name || it.code, sellPrice: Number(it.sellPrice) || 0 } };
    });
  });
}

export type ItemSearchResult = {
  id: string;
  code: string;
  name: string;
  sellPrice: number;
  image: string | null;
  stock: number; // on-hand
  reserved: number;
  available: number; // on-hand − reserved
  codes: { type: string; code: string }[];
};

/**
 * Search active-org items by internal code, Arabic/English name, or any linked
 * external code (SKU/ASIN/UPC/EAN/barcode). Thin auth wrapper over
 * {@link searchItems}; the query core is shared with the mobile API.
 */
export async function searchItemsAction(query: string): Promise<ItemSearchResult[]> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return [];
  return withOrgScope(auth.orgId, false, async () => {
    return searchItems(auth.orgId, query);
  });
}

/** Exact barcode/SKU lookup (scan) — the single matching item or null. */
export async function scanItemAction(code: string): Promise<ItemSearchResult | null> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return null;
  return withOrgScope(auth.orgId, false, async () => {
    return scanItem(auth.orgId, code);
  });
}
