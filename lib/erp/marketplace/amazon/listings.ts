import "server-only";
import { spJson } from "./client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";
import type { MarketplaceProduct } from "../dto";

// Direct product source: Listings Items API 2021-08-01 searchListingsItems —
// returns the seller's listings as JSON (sku, asin, name, price) with no async
// report. Replaces the GET_MERCHANT_LISTINGS report in the connector.

type Offer = { price?: { amount?: string | number } };
type ListingItem = {
  sku?: string;
  summaries?: { asin?: string; itemName?: string }[];
  offers?: Offer[];
  attributes?: Record<string, unknown>;
};
type ListingsResponse = { items?: ListingItem[]; pagination?: { nextToken?: string } };

/** Best-effort price from a listing item (offers, else common attribute paths, else 0). */
function priceOf(item: ListingItem): number {
  const off = item.offers?.find((o) => o.price?.amount != null)?.price?.amount;
  if (off != null) return round2(Number(off) || 0);
  // Attribute fallback: purchasable_offer → our_price → schedule → value_with_tax.
  const a = item.attributes as Record<string, unknown> | undefined;
  const po = (a?.purchasable_offer as { our_price?: { schedule?: { value_with_tax?: number }[] }[] }[] | undefined)?.[0];
  const v = po?.our_price?.[0]?.schedule?.[0]?.value_with_tax;
  return v != null ? round2(Number(v) || 0) : 0;
}

/** Pure: one listing item → MarketplaceProduct (skips items without a sku). */
export function listingToProduct(item: ListingItem): MarketplaceProduct | null {
  if (!item.sku) return null;
  const s = item.summaries?.[0];
  return { code: item.sku, altCode: s?.asin, name: s?.itemName || item.sku, sellPrice: priceOf(item) };
}

export async function fetchListings(cred: Credential): Promise<MarketplaceProduct[]> {
  if (!cred.sellerId || !cred.marketplaceId) return [];
  const out: MarketplaceProduct[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 100; page++) {
    const qs = new URLSearchParams({ marketplaceIds: cred.marketplaceId, includedData: "summaries,offers,attributes", pageSize: "20" });
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await spJson<ListingsResponse>(cred, `/listings/2021-08-01/items/${encodeURIComponent(cred.sellerId)}?${qs}`);
    for (const it of res.items ?? []) { const p = listingToProduct(it); if (p) out.push(p); }
    pageToken = res.pagination?.nextToken;
    if (!pageToken) break;
  }
  return out;
}
