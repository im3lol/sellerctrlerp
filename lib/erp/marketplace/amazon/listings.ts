import "server-only";
import { spJson, paced, credKey } from "./client";
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

/**
 * Merge the full catalog (from FBA inventory — has every SKU, no price) with the
 * priced listings slice (≤1000, capped by Amazon). Full set wins for existence;
 * price is overlaid from listings where present. Listings-only SKUs (e.g. FBM,
 * not in FBA inventory) are still included.
 */
export function mergeProducts(full: MarketplaceProduct[], priced: MarketplaceProduct[]): MarketplaceProduct[] {
  const priceBySku = new Map(priced.map((l) => [l.code, l.sellPrice]));
  const bySku = new Map<string, MarketplaceProduct>();
  for (const p of full) bySku.set(p.code, { ...p, sellPrice: priceBySku.get(p.code) ?? p.sellPrice });
  for (const l of priced) if (!bySku.has(l.code)) bySku.set(l.code, l);
  return [...bySku.values()];
}

/**
 * Fetch the seller's listings. Pass `lastUpdatedAfter` for an incremental sync —
 * Amazon returns only listings created/changed since then, so a new product is
 * picked up fast without re-scanning the whole catalog. Omit it for a full sync.
 */
export async function fetchListings(cred: Credential, lastUpdatedAfter?: Date): Promise<MarketplaceProduct[]> {
  if (!cred.sellerId || !cred.marketplaceId) return [];
  const out: MarketplaceProduct[] = [];
  let pageToken: string | undefined;
  // searchListingsItems is HARD-CAPPED at 1000 results by Amazon (nextToken stops
  // there regardless of pageSize) — so this can't enumerate an 11k catalog on its
  // own; full enumeration is fetchInventoryProducts (FBA, uncapped). Used here for
  // incremental syncs (lastUpdatedAfter → few changes) and to overlay price on the
  // full pull. 60-page ceiling (×20 = 1200) covers Amazon's 1000 with slack.
  for (let page = 0; page < 60; page++) {
    const qs = new URLSearchParams({ marketplaceIds: cred.marketplaceId, includedData: "summaries,offers,attributes", pageSize: "20" });
    if (lastUpdatedAfter) qs.set("lastUpdatedAfter", lastUpdatedAfter.toISOString());
    if (pageToken) qs.set("pageToken", pageToken);
    let res: ListingsResponse;
    try {
      // searchListingsItems is 5/s — pace pages proactively instead of eating 429s.
      res = await paced(`amazon-listings:${credKey(cred)}`, 250, () =>
        spJson<ListingsResponse>(cred, `/listings/2021-08-01/items/${encodeURIComponent(cred.sellerId!)}?${qs}`));
    } catch {
      if (out.length) break; // keep pages already pulled instead of losing the whole run
      throw new Error("تعذّر سحب قائمة المنتجات من أمازون");
    }
    for (const it of res.items ?? []) { const p = listingToProduct(it); if (p) out.push(p); }
    pageToken = res.pagination?.nextToken;
    if (!pageToken) break;
  }
  return out;
}
