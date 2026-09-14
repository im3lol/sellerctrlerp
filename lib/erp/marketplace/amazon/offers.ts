import "server-only";
import { spJson, paced, credKey } from "./client";
import type { Credential } from "../connector";

// Product Pricing v0 — getListingOffersBatch: the competitive picture for up to 20 of MY
// SKUs per call (~0.5 req/s). Probed live 2026-09-14: each response's body.payload carries
// SKU, Summary {BuyBoxPrices, LowestPrices, TotalOfferCount} and Offers[] with MyOffer /
// IsBuyBoxWinner / ListingPrice / Shipping.

type Money = { CurrencyCode?: string; Amount?: number };
type Offer = { MyOffer?: boolean; IsBuyBoxWinner?: boolean; ListingPrice?: Money; Shipping?: Money };
type PriceRow = { condition?: string; LandedPrice?: Money; ListingPrice?: Money; Shipping?: Money };
export type ListingOffersPayload = {
  SKU?: string;
  Summary?: { BuyBoxPrices?: PriceRow[]; LowestPrices?: PriceRow[]; TotalOfferCount?: number };
  Offers?: Offer[];
};

export type OfferSnapshot = {
  sku: string;
  currency: string | null;
  /** My offer's landed price (listing + shipping), when Amazon returned my offer. */
  myPrice: number | null;
  buyBoxPrice: number | null;
  lowestPrice: number | null;
  offerCount: number;
  /** true = I hold the Buy Box, false = someone else does, null = nobody (no Buy Box shown). */
  isWinner: boolean | null;
};

const amt = (m?: Money) => (m && Number.isFinite(Number(m.Amount)) ? Number(m.Amount) : null);
const landed = (p?: PriceRow) => amt(p?.LandedPrice) ?? (amt(p?.ListingPrice) != null ? (amt(p?.ListingPrice) ?? 0) + (amt(p?.Shipping) ?? 0) : null);
const isNew = (c?: string) => !c || c.toLowerCase() === "new";

/** Pure: one listing's payload → a snapshot. Landed prices on both sides, so shipping counts. */
export function parseListingOffers(sku: string, p: ListingOffersPayload): OfferSnapshot {
  const offers = p.Offers ?? [];
  const mine = offers.find((o) => o.MyOffer);
  const buyBox = (p.Summary?.BuyBoxPrices ?? []).find((b) => isNew(b.condition));
  const lows = (p.Summary?.LowestPrices ?? []).filter((l) => isNew(l.condition)).map(landed).filter((n): n is number => n != null);
  const myPrice = mine ? (amt(mine.ListingPrice) ?? 0) + (amt(mine.Shipping) ?? 0) : null;
  const buyBoxPrice = landed(buyBox);
  return {
    sku,
    currency: mine?.ListingPrice?.CurrencyCode ?? buyBox?.LandedPrice?.CurrencyCode ?? offers[0]?.ListingPrice?.CurrencyCode ?? null,
    myPrice: myPrice != null ? Math.round(myPrice * 100) / 100 : null,
    buyBoxPrice,
    lowestPrice: lows.length ? Math.min(...lows) : null,
    offerCount: p.Summary?.TotalOfferCount ?? offers.length,
    isWinner: mine?.IsBuyBoxWinner ? true : buyBoxPrice != null || offers.some((o) => o.IsBuyBoxWinner) ? false : null,
  };
}

type BatchResp = { responses?: { status?: { statusCode?: number }; body?: { payload?: ListingOffersPayload }; request?: { SellerSKU?: string } }[] };

/** Competitive offers for my SKUs, 20 per call. A failed batch is skipped, not fatal. */
export async function fetchListingOffers(cred: Credential, skus: string[]): Promise<OfferSnapshot[]> {
  if (!cred.marketplaceId) return [];
  const out: OfferSnapshot[] = [];
  for (let i = 0; i < skus.length; i += 20) {
    const batch = skus.slice(i, i + 20);
    const body = {
      requests: batch.map((sku) => ({
        uri: `/products/pricing/v0/listings/${encodeURIComponent(sku)}/offers`, method: "GET",
        MarketplaceId: cred.marketplaceId, ItemCondition: "New",
      })),
    };
    try {
      const resp = await paced(`amazon-offers:${credKey(cred)}`, 2100, () =>
        spJson<BatchResp>(cred, `/batches/products/pricing/v0/listingOffers`, { method: "POST", body: JSON.stringify(body) }));
      (resp.responses ?? []).forEach((r, k) => {
        const payload = r.body?.payload;
        if ((r.status?.statusCode ?? 200) >= 400 || !payload) return;
        out.push(parseListingOffers(payload.SKU ?? r.request?.SellerSKU ?? batch[k], payload));
      });
    } catch {
      // One batch failing (throttle, a bad SKU) shouldn't lose the rest of the run.
    }
  }
  return out;
}
