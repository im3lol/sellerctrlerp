import "server-only";
import { spJson, paced, credKey } from "./client";
import type { Credential } from "../connector";
import type { MarketplaceInventory, MarketplaceInventoryDetail, MarketplaceProduct } from "../dto";

// Direct inventory source: FBA Inventory API v1 getInventorySummaries — JSON,
// no async report. Replaces the FBA ledger report in the connector.

type Reserved = { totalReservedQuantity?: number; pendingCustomerOrderQuantity?: number; pendingTransshipmentQuantity?: number; fcProcessingQuantity?: number };
type Unfulfillable = { totalUnfulfillableQuantity?: number; customerDamagedQuantity?: number; warehouseDamagedQuantity?: number; distributorDamagedQuantity?: number; carrierDamagedQuantity?: number; defectiveQuantity?: number; expiredQuantity?: number };
type Researching = { totalResearchingQuantity?: number };
type InvDetails = {
  fulfillableQuantity?: number;
  inboundWorkingQuantity?: number;
  inboundShippedQuantity?: number;
  inboundReceivingQuantity?: number;
  reservedQuantity?: Reserved;
  unfulfillableQuantity?: Unfulfillable;
  researchingQuantity?: Researching;
};
type Summary = { sellerSku?: string; asin?: string; fnSku?: string; productName?: string; totalQuantity?: number; inventoryDetails?: InvDetails };
type InvResponse = { pagination?: { nextToken?: string }; payload?: { inventorySummaries?: Summary[] } };

const n = (v?: number) => Number(v ?? 0) || 0;

/** Pure: an inventory summary → MarketplaceInventory (skips rows without a SKU). */
export function summaryToInventory(s: Summary): MarketplaceInventory | null {
  if (!s.sellerSku) return null;
  return { code: s.sellerSku, title: s.productName ?? "", onHand: n(s.totalQuantity) };
}

/** Pure: an inventory summary → the full breakdown (skips rows without a SKU). */
export function summaryToDetail(s: Summary): MarketplaceInventoryDetail | null {
  if (!s.sellerSku) return null;
  const d = s.inventoryDetails ?? {};
  const r = d.reservedQuantity ?? {};
  const u = d.unfulfillableQuantity ?? {};
  return {
    code: s.sellerSku, asin: s.asin, fnsku: s.fnSku, title: s.productName ?? "",
    total: n(s.totalQuantity),
    fulfillable: n(d.fulfillableQuantity),
    inboundWorking: n(d.inboundWorkingQuantity),
    inboundShipped: n(d.inboundShippedQuantity),
    inboundReceiving: n(d.inboundReceivingQuantity),
    reservedTotal: n(r.totalReservedQuantity),
    reservedCustomerOrder: n(r.pendingCustomerOrderQuantity),
    reservedTransshipment: n(r.pendingTransshipmentQuantity),
    reservedFcProcessing: n(r.fcProcessingQuantity),
    unfulfillableTotal: n(u.totalUnfulfillableQuantity),
    warehouseDamaged: n(u.warehouseDamagedQuantity),
    customerDamaged: n(u.customerDamagedQuantity),
    carrierDamaged: n(u.carrierDamagedQuantity),
    distributorDamaged: n(u.distributorDamagedQuantity),
    defective: n(u.defectiveQuantity),
    expired: n(u.expiredQuantity),
    researching: n(d.researchingQuantity?.totalResearchingQuantity),
  };
}

/** Page through every FBA summary (50/page), mapping each row via `map`. */
async function eachSummary<T>(cred: Credential, map: (s: Summary) => T | null): Promise<T[]> {
  if (!cred.marketplaceId) return [];
  const out: T[] = [];
  let next: string | undefined;
  // No 1000-item ceiling here (unlike searchListingsItems): getInventorySummaries
  // pages the WHOLE FBA catalog via nextToken. 2000-page safety cap ≈ 100k SKUs.
  for (let page = 0; page < 2000; page++) {
    const qs = new URLSearchParams({ details: "true", granularityType: "Marketplace", granularityId: cred.marketplaceId, marketplaceIds: cred.marketplaceId });
    if (next) qs.set("nextToken", next);
    let res: InvResponse;
    try {
      // getInventorySummaries is 2/s — pace pages proactively.
      res = await paced(`amazon-inventory:${credKey(cred)}`, 550, () =>
        spJson<InvResponse>(cred, `/fba/inventory/v1/summaries?${qs}`));
    } catch {
      if (out.length) break; // keep pages already pulled instead of losing the run
      throw new Error("تعذّر سحب مخزون FBA من أمازون");
    }
    for (const s of res.payload?.inventorySummaries ?? []) { const v = map(s); if (v) out.push(v); }
    next = res.pagination?.nextToken;
    if (!next) break;
  }
  return out;
}

export function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  return eachSummary(cred, summaryToInventory);
}

/** Full FBA breakdown per SKU — the Inventory Auditor's data source. */
export function fetchInventoryDetail(cred: Credential): Promise<MarketplaceInventoryDetail[]> {
  return eachSummary(cred, summaryToDetail);
}

/**
 * Full product enumeration for FBA sellers — getInventorySummaries has NO 1000
 * result cap (searchListingsItems does), so this is the only live way to pull an
 * 11k+ catalog. Gives sku+asin+name; price is 0 here (overlaid from listings /
 * enriched from the catalog by the caller).
 */
export function fetchInventoryProducts(cred: Credential): Promise<MarketplaceProduct[]> {
  return eachSummary(cred, (s) =>
    s.sellerSku ? { code: s.sellerSku, altCode: s.asin, name: s.productName || s.sellerSku, sellPrice: 0 } : null,
  );
}
