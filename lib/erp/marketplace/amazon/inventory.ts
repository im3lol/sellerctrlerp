import "server-only";
import { spJson } from "./client";
import type { Credential } from "../connector";
import type { MarketplaceInventory } from "../dto";

// Direct inventory source: FBA Inventory API v1 getInventorySummaries — JSON,
// no async report. Replaces the FBA ledger report in the connector.

type Summary = { sellerSku?: string; productName?: string; totalQuantity?: number };
type InvResponse = { pagination?: { nextToken?: string }; payload?: { inventorySummaries?: Summary[] } };

/** Pure: an inventory summary → MarketplaceInventory (skips rows without a SKU). */
export function summaryToInventory(s: Summary): MarketplaceInventory | null {
  if (!s.sellerSku) return null;
  return { code: s.sellerSku, title: s.productName ?? "", onHand: Number(s.totalQuantity ?? 0) || 0 };
}

export async function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  if (!cred.marketplaceId) return [];
  const out: MarketplaceInventory[] = [];
  let next: string | undefined;
  for (let page = 0; page < 100; page++) {
    const qs = new URLSearchParams({ details: "true", granularityType: "Marketplace", granularityId: cred.marketplaceId, marketplaceIds: cred.marketplaceId });
    if (next) qs.set("nextToken", next);
    const res = await spJson<InvResponse>(cred, `/fba/inventory/v1/summaries?${qs}`);
    for (const s of res.payload?.inventorySummaries ?? []) { const inv = summaryToInventory(s); if (inv) out.push(inv); }
    next = res.pagination?.nextToken;
    if (!next) break;
  }
  return out;
}
