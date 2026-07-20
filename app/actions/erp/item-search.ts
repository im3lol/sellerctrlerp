"use server";

import { withOrgScope } from "@/lib/db-scope";
import { authorizeErp } from "@/lib/erp/action-auth";
import { searchItems, scanItem } from "@/lib/erp/inventory-queries";

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
