import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceProduct } from "../dto";
import { wcPaginate } from "./client";

// WooCommerce products → neutral MarketplaceProduct. `code` is the seller SKU (primary
// match key); `altCode` carries the WC product id (the WOO code type) as a fallback, mirroring
// how Amazon carries the ASIN. Variable products expose their variations as separate rows.

export type WooProduct = {
  id: number;
  name: string;
  sku: string | null;
  type?: string;          // "simple" | "variable" | "variation"
  price?: string | null;
  stock_quantity?: number | null;
  manage_stock?: boolean;
  images?: { src?: string }[];
};

/** Pure: WC product → MarketplaceProduct. Blank SKU falls back to the WC id so a row is never blank-coded. */
export function productToProduct(p: WooProduct): MarketplaceProduct {
  return {
    code: (p.sku || "").trim() || `WC-${p.id}`,
    altCode: String(p.id),
    name: p.name,
    sellPrice: Number(p.price) || 0,
  };
}

export const productsToRows = (rows: WooProduct[]): MarketplaceProduct[] => rows.map(productToProduct);

export async function fetchProducts(cred: Credential, since?: Date): Promise<MarketplaceProduct[]> {
  const params: Record<string, string> = { status: "publish" };
  if (since) params.modified_after = since.toISOString();
  const rows = await wcPaginate<WooProduct>(cred, "products", params);
  return productsToRows(rows);
}

/** Full import = the complete enumeration (no `since`). WC has no result cap → one path. */
export const fetchFullProducts = (cred: Credential) => fetchProducts(cred);
