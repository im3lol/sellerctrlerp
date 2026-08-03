import "server-only";
import type { MarketplaceConnector, ConnectorMarketplace, OAuthExchange } from "../connector";
import { MARKETPLACES, marketplaceByCode } from "./constants";
import { exchangeCode as lwaExchange } from "./lwa";
import { getAmazonConfig } from "@/lib/saas/amazon-config";
import { fetchCatalog } from "./catalog";
import { fetchListings, mergeProducts } from "./listings";
import { fetchFullListings } from "./reports";
import { fetchOrders } from "./orders";
import { fetchInventory, fetchInventoryDetail, fetchInventoryProducts } from "./inventory";
import { fetchSettlements } from "./settlement-report";
import { fetchFbaReturns } from "./returns-report";
import { fetchReimbursements, fetchLedgerEvents } from "./finance-reports";
import { fetchFeesEstimates } from "./fees";
import type { MarketplaceProduct } from "../dto";

const marketplaces: ConnectorMarketplace[] = MARKETPLACES.map((m) => ({
  code: m.code, name: m.name, region: m.region, marketplaceId: m.marketplaceId,
}));

/** Amazon SP-API connector (first real MarketplaceConnector). */
export const amazonConnector: MarketplaceConnector = {
  code: "AMAZON",
  label: "أمازون",
  capabilities: { products: true, catalog: true, orders: true, inventory: true, settlements: true },
  oauth: {
    marketplaces,
    async authorizeUrl(state, marketplaceCode) {
      const appId = (await getAmazonConfig())?.appId;
      const mp = marketplaceByCode(marketplaceCode);
      if (!appId || !mp) return null;
      const url = new URL(`${mp.sellerCentral}/apps/authorize/consent`);
      url.searchParams.set("application_id", appId);
      url.searchParams.set("state", state);
      // version=beta only while the app is still a draft in Seller Central.
      if (process.env.SPAPI_DRAFT === "1") url.searchParams.set("version", "beta");
      return url.toString();
    },
    async exchangeCode(code, redirectUri): Promise<OAuthExchange> {
      const tok = await lwaExchange(code, redirectUri);
      if ("error" in tok) return { error: tok.error };
      if (!tok.refresh_token) return { error: "لم يصل refresh token من أمازون" };
      return { refreshToken: tok.refresh_token };
    },
  },
  // Direct SP-API endpoints (JSON, synchronous) — no async report polling.
  // Incremental (since set): only changed listings — fast, ≤1000 changes is plenty.
  // Full (no since): searchListingsItems is capped at 1000 by Amazon, so enumerate
  // the WHOLE FBA catalog via getInventorySummaries (uncapped) and overlay price
  // from the listings slice. FBM/listings-only SKUs are still included.
  async fetchProducts(cred, since): Promise<MarketplaceProduct[]> {
    if (since) return fetchListings(cred, since);
    const [listings, invProducts] = await Promise.all([
      fetchListings(cred).catch(() => [] as MarketplaceProduct[]),
      fetchInventoryProducts(cred),
    ]);
    return mergeProducts(invProducts, listings);
  },
  // Full import: the Reports API (complete, no 1000 cap). Slow/async — workers only.
  fetchFullProducts(cred) {
    return fetchFullListings(cred);
  },
  fetchCatalog(cred, asins) {
    return fetchCatalog(cred, asins);
  },
  fetchOrders(cred, range) {
    return fetchOrders(cred, range);
  },
  fetchInventory(cred) {
    return fetchInventory(cred);
  },
  fetchInventoryDetail(cred) {
    return fetchInventoryDetail(cred);
  },
  fetchSettlements(cred, range) {
    return fetchSettlements(cred, range);
  },
  fetchReturns(cred, range) {
    return fetchFbaReturns(cred, range);
  },
  fetchReimbursements(cred, range) {
    return fetchReimbursements(cred, range);
  },
  fetchLedgerEvents(cred, range) {
    return fetchLedgerEvents(cred, range);
  },
  fetchFees(cred, skus) {
    return fetchFeesEstimates(cred, skus);
  },
};
