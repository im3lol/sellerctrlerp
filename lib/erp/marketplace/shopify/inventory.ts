import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceInventory } from "../dto";
import { paginate } from "./client";

// Ending on-hand per seller SKU for a warehouse reconciliation (read-only). Summed
// across all locations — the ERP reconciles against its single default warehouse.

const INV_QUERY = `query ShopifyInventory($cursor: String) {
  productVariants(first: 100, after: $cursor) {
    nodes { sku displayName inventoryQuantity }
    pageInfo { hasNextPage endCursor }
  }
}`;

type VariantNode = { sku: string | null; displayName: string; inventoryQuantity: number | null };
type InvData = { productVariants: { nodes: VariantNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };

/** Pure: variant → inventory row. Variants without a SKU can't reconcile, so drop them. */
export function variantToInventory(v: VariantNode): MarketplaceInventory | null {
  const code = (v.sku || "").trim();
  if (!code) return null;
  return { code, title: v.displayName, onHand: Number(v.inventoryQuantity) || 0 };
}

export const nodesToInventory = (nodes: VariantNode[]): MarketplaceInventory[] =>
  nodes.map(variantToInventory).filter((x): x is MarketplaceInventory => x !== null);

export async function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  const nodes = await paginate<VariantNode, InvData>(cred, INV_QUERY, {}, (d) => d.productVariants);
  return nodesToInventory(nodes);
}
