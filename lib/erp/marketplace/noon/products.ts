import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceProduct } from "../dto";
import { noonFetch } from "./client";
import { stockList, skuOf } from "./inventory";

// Noon offers → neutral MarketplaceProduct. Noon has no "list all offers" endpoint,
// so we enumerate the seller's SKUs from the stock service, then read each offer for
// its title + price via `GET /offer/v1/product/{partner_sku}`.
// ponytail: SKUs with zero stock AND no order won't appear until they're stocked/sold —
// the only enumerator Noon exposes is stock-list. Fine for a read-only MVP.

type NoonOffer = {
  price?: { amount?: number | null; currency?: string } | null;
  active_net_stock?: number;
};
type OfferResp = {
  partner_sku?: string;
  sku?: string;   // noon's own SKU (carried as the NOON code type, like an ASIN)
  title?: string;
  brand?: string;
  offers?: NoonOffer[];
};

/** Pure: one offer response → a product row (null if it has no usable SKU). */
export function offerToProduct(partnerSku: string, o: OfferResp): MarketplaceProduct | null {
  const code = (o.partner_sku ?? partnerSku ?? "").trim();
  if (!code) return null;
  const price = o.offers?.map((x) => x.price?.amount).find((a) => a != null) ?? 0;
  return { code, altCode: o.sku?.trim() || undefined, name: (o.title ?? code).trim(), sellPrice: Number(price) || 0 };
}

export async function fetchProducts(cred: Credential): Promise<MarketplaceProduct[]> {
  const skus = [...new Set((await stockList(cred)).map(skuOf).filter(Boolean))];
  const out: MarketplaceProduct[] = [];
  // ponytail: sequential per-SKU reads. Noon allows 1500 req/min, so hundreds of SKUs
  // are fine; batch with p-limit only if a large catalog gets slow.
  for (const sku of skus) {
    try {
      const o = await noonFetch<OfferResp>(cred.refreshToken, `/offer/v1/product/${encodeURIComponent(sku)}`);
      const p = offerToProduct(sku, o);
      if (p) out.push(p);
    } catch { /* skip a SKU whose offer read fails; the rest still import */ }
  }
  return out;
}

export const fetchFullProducts = (cred: Credential) => fetchProducts(cred);
