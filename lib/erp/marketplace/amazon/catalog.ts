import "server-only";
import { toKg, toCm, formatWeight, formatDimensionsCm } from "@/lib/erp/units-convert";
import { spJson, paced, credKey } from "./client";
import type { Credential, CatalogRecord, CatalogIdentifier } from "../connector";

// Catalog Items API (2022-04-01): enrich synced products by ASIN with image URL,
// barcodes (identifiers), brand, dimensions, and variation parent/child links.
// One batched call (20 ASINs) fetches everything via includedData.

type Img = { variant?: string; link?: string };
type Dim = { value?: number; unit?: string };
type CatalogItem = {
  asin?: string;
  summaries?: { itemName?: string; brand?: string; color?: string; size?: string }[];
  identifiers?: { identifiers?: { identifierType?: string; identifier?: string }[] }[];
  images?: { images?: Img[] }[];
  dimensions?: { item?: { length?: Dim; width?: Dim; height?: Dim; weight?: Dim } }[];
  relationships?: { relationships?: { parentAsins?: string[] }[] }[];
  // Browse-node classification per marketplace → we take the leaf display name as category.
  classifications?: { classifications?: { displayName?: string }[] }[];
};
type CatalogResponse = { items?: CatalogItem[] };

const INCLUDED = "summaries,identifiers,images,dimensions,relationships,classifications";
// Amazon identifier types we store as barcodes (mapped to our item_codes types).
const BARCODE_TYPES: Record<string, string> = { UPC: "UPC", EAN: "EAN", GTIN: "BARCODE", ISBN: "BARCODE" };

const num = (d?: Dim) => (typeof d?.value === "number" ? Math.round(d.value * 1000) / 1000 : undefined);

/** Pure: map a Catalog Items response → CatalogRecord[]. */
export function parseCatalog(res: CatalogResponse): CatalogRecord[] {
  const out: CatalogRecord[] = [];
  for (const it of res.items ?? []) {
    if (!it.asin) continue;
    const sum = it.summaries?.[0];

    const imgs = it.images?.[0]?.images ?? [];
    const imageUrl = (imgs.find((i) => i.variant === "MAIN") ?? imgs[0])?.link;

    const identifiers: CatalogIdentifier[] = [];
    for (const id of it.identifiers?.[0]?.identifiers ?? []) {
      const mapped = id.identifierType ? BARCODE_TYPES[id.identifierType.toUpperCase()] : undefined;
      if (mapped && id.identifier) identifiers.push({ type: mapped, code: String(id.identifier) });
    }

    // Amazon answers in the marketplace's own units — pounds and inches on the US
    // catalogue. Keeping that verbatim gives an Egyptian seller a number they cannot use,
    // and leaves items.weightKg empty, which is the column freight-by-weight allocation
    // divides by. Convert here, once, and store metric.
    const dim = it.dimensions?.[0]?.item;
    const w = num(dim?.weight);
    const weightKg = w !== undefined ? toKg(w, dim?.weight?.unit ?? "") ?? undefined : undefined;
    const weight = formatWeight(weightKg) ?? undefined;
    const dimUnit = dim?.length?.unit ?? dim?.width?.unit ?? dim?.height?.unit ?? "";
    const cm = (v: number | undefined) => (v !== undefined ? toCm(v, dimUnit) : null);
    const dimensions = formatDimensionsCm(cm(num(dim?.length)), cm(num(dim?.width)), cm(num(dim?.height))) ?? undefined;

    const variationValue = [sum?.color, sum?.size].filter(Boolean).join(" / ") || undefined;
    const parentAsin = it.relationships?.[0]?.relationships?.find((r) => r.parentAsins?.length)?.parentAsins?.[0];
    const category = it.classifications?.[0]?.classifications?.find((c) => c.displayName)?.displayName || undefined;

    out.push({ asin: it.asin, imageUrl, brand: sum?.brand || undefined, weight, weightKg, dimensions, name: sum?.itemName || undefined, identifiers, parentAsin, variationValue, category });
  }
  return out;
}

const chunk = <T>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Fetch catalog enrichment for the given ASINs (batched 20/call to respect rate limits). */
export async function fetchCatalog(cred: Credential, asins: string[]): Promise<CatalogRecord[]> {
  if (!cred.marketplaceId) return [];
  const unique = [...new Set(asins.map((a) => a.trim()).filter(Boolean))];
  const out: CatalogRecord[] = [];
  for (const batch of chunk(unique, 20)) {
    const qs = new URLSearchParams({ identifiers: batch.join(","), identifiersType: "ASIN", marketplaceIds: cred.marketplaceId, includedData: INCLUDED });
    try {
      // searchCatalogItems is 2/s — pace batches proactively.
      out.push(...parseCatalog(await paced(`amazon-catalog:${credKey(cred)}`, 550, () =>
        spJson<CatalogResponse>(cred, `/catalog/2022-04-01/items?${qs}`))));
    } catch {
      // A failed batch shouldn't abort the whole enrichment; skip it.
    }
  }
  return out;
}
