import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceProduct } from "../dto";
import { shopifyGraphql, paginate } from "./client";

// Shopify products → neutral MarketplaceProduct (one row per variant). `code` is the
// seller SKU (primary match key); `altCode` is the variant GID (carried as the
// SHOPIFY code type, mirroring how Amazon carries the ASIN).

const PRODUCTS_QUERY = `query ShopifyProducts($cursor: String, $query: String) {
  products(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) {
    nodes { title variants(first: 100) { nodes { id sku title price } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

type VariantNode = { id: string; sku: string | null; title: string | null; price: string | null };
type ProductNode = { title: string; variants: { nodes: VariantNode[] } };
type ProductsData = { products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

/** Pure: flatten one product's variants into MarketplaceProduct rows. */
export function productToRows(p: ProductNode): MarketplaceProduct[] {
  return p.variants.nodes.map((v) => {
    const variantTitle = v.title && v.title !== "Default Title" ? ` - ${v.title}` : "";
    return {
      code: (v.sku || "").trim() || v.id, // fall back to the GID so a blank SKU never creates a blank-coded item
      altCode: v.id,
      name: `${p.title}${variantTitle}`,
      sellPrice: Number(v.price) || 0,
    };
  });
}

export const nodesToProducts = (nodes: ProductNode[]): MarketplaceProduct[] => nodes.flatMap(productToRows);

export async function fetchProducts(cred: Credential, since?: Date): Promise<MarketplaceProduct[]> {
  const query = since ? `updated_at:>='${since.toISOString()}'` : null;
  const nodes = await paginate<ProductNode, ProductsData>(cred, PRODUCTS_QUERY, { query }, (d) => d.products);
  return nodesToProducts(nodes);
}

/** Full import = same query with no `since`. Shopify has no result cap, so this is
 *  just the complete enumeration (no separate slow report path like Amazon). */
export const fetchFullProducts = (cred: Credential) => fetchProducts(cred);

// ponytail: variants(first:100) covers the vast majority of stores; a product with
// >100 variants truncates. Add variant-level pagination only if a real store hits it.
export { PRODUCTS_QUERY };
