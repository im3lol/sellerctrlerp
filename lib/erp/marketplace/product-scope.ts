import type { MarketplaceProduct } from "./dto";

/** Fulfillment is listing metadata, never inferred from historical warehouse rows. */
export function selectProductScope(products: MarketplaceProduct[], channel: string, fulfillment?: string | null) {
  if (channel !== "AMAZON" || (fulfillment !== "FBA" && fulfillment !== "FBM")) return products;
  if (products.some((p) => !p.fulfillment)) throw new Error("Amazon listing fulfillment is missing; refusing an ambiguous product import");
  return products.filter((p) => p.fulfillment === fulfillment);
}

/** Several current seller SKUs may describe the same physical ASIN. */
export function groupProductMasters(products: MarketplaceProduct[]) {
  const groups = new Map<string, MarketplaceProduct[]>();
  for (const p of products) {
    const key = p.altCode ? `asin:${p.altCode.trim().toUpperCase()}` : `sku:${p.code}`;
    const group = groups.get(key) ?? [];
    group.push(p); groups.set(key, group);
  }
  return [...groups.values()];
}
