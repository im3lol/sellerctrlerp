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
  fulfillmentAvailability?: { fulfillmentChannelCode?: string }[];
};
type ListingsResponse = { items?: ListingItem[]; pagination?: { nextToken?: string } };
export class ListingsResultLimitError extends Error {}

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
  const channels = item.fulfillmentAvailability?.map((f) => f.fulfillmentChannelCode) ?? [];
  const fulfillment = channels.some((c) => c?.startsWith("AMAZON") || c === "AFN") ? "FBA" as const
    : channels.some((c) => c === "DEFAULT" || c === "MFN") ? "FBM" as const : undefined;
  return { code: item.sku, altCode: s?.asin, name: s?.itemName || item.sku, sellPrice: priceOf(item), ...(fulfillment ? { fulfillment } : {}) };
}

/**
 * Current seller listings define membership, identity and price. FBA summaries
 * are historical and may only supply FNSKU for the SAME SKU AND ASIN.
 */
export function mergeProducts(full: MarketplaceProduct[], priced: MarketplaceProduct[]): MarketplaceProduct[] {
  const inventoryBySku = new Map(full.map((p) => [`${p.code}|${p.altCode ?? ""}`, p]));
  return priced.map((listing) => {
    const inventory = inventoryBySku.get(`${listing.code}|${listing.altCode ?? ""}`);
    return inventory?.altCode && inventory.altCode === listing.altCode && listing.fulfillment !== "FBM"
      ? { ...listing, fnsku: inventory.fnsku ?? listing.fnsku }
      : { ...listing };
  });
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
  // there regardless of pageSize). Full enumeration uses the listings report;
  // incremental reads that hit this ceiling fail rather than report false success.
  for (let page = 0; page < 60; page++) {
    const qs = new URLSearchParams({ marketplaceIds: cred.marketplaceId, includedData: "summaries,offers,attributes,fulfillmentAvailability", pageSize: "20" });
    if (lastUpdatedAfter) qs.set("lastUpdatedAfter", lastUpdatedAfter.toISOString());
    if (pageToken) qs.set("pageToken", pageToken);
    let res: ListingsResponse;
    try {
      // searchListingsItems is 5/s — pace pages proactively instead of eating 429s.
      res = await paced(`amazon-listings:${credKey(cred)}`, 250, () =>
        spJson<ListingsResponse>(cred, `/listings/2021-08-01/items/${encodeURIComponent(cred.sellerId!)}?${qs}`));
    } catch {
      throw new Error("تعذّر سحب قائمة المنتجات من أمازون");
    }
    for (const it of res.items ?? []) { const p = listingToProduct(it); if (p) out.push(p); }
    pageToken = res.pagination?.nextToken;
    if (out.length >= 1000 || (page === 59 && pageToken)) throw new ListingsResultLimitError("Amazon listing result limit reached; run a full product import");
    if (!pageToken) break;
  }
  return out;
}
