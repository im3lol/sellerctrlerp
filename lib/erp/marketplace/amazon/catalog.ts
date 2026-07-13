import "server-only";
import { spJson } from "./client";
import type { Credential } from "../connector";

// Catalog Items API (2022-04-01): fetch the main product image URL per ASIN.
// Images live in the catalog, not the listings report, so this enriches synced
// products with an image link (we store the URL directly — no download).

type CatalogImage = { variant?: string; link?: string; height?: number; width?: number };
type CatalogItem = { asin?: string; images?: { marketplaceId?: string; images?: CatalogImage[] }[] };
type CatalogResponse = { items?: CatalogItem[] };

/** Pure: pull {asin, imageUrl} from a Catalog Items response (MAIN variant, else first). */
export function parseCatalogImages(res: CatalogResponse): { asin: string; imageUrl: string }[] {
  const out: { asin: string; imageUrl: string }[] = [];
  for (const item of res.items ?? []) {
    if (!item.asin) continue;
    const imgs = item.images?.[0]?.images ?? [];
    const main = imgs.find((i) => i.variant === "MAIN") ?? imgs[0];
    if (main?.link) out.push({ asin: item.asin, imageUrl: main.link });
  }
  return out;
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Fetch main image URLs for the given ASINs (batched 20/call to respect rate limits). */
export async function fetchImages(cred: Credential, asins: string[]): Promise<{ asin: string; imageUrl: string }[]> {
  if (!cred.marketplaceId) return [];
  const unique = [...new Set(asins.map((a) => a.trim()).filter(Boolean))];
  const out: { asin: string; imageUrl: string }[] = [];
  for (const batch of chunk(unique, 20)) {
    const qs = new URLSearchParams({
      identifiers: batch.join(","),
      identifiersType: "ASIN",
      marketplaceIds: cred.marketplaceId,
      includedData: "images",
    });
    try {
      const res = await spJson<CatalogResponse>(cred, `/catalog/2022-04-01/items?${qs}`);
      out.push(...parseCatalogImages(res));
    } catch {
      // A failed batch shouldn't abort the whole enrichment; skip it.
    }
  }
  return out;
}
