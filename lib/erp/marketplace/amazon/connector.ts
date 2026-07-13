import "server-only";
import type { MarketplaceConnector, ConnectorMarketplace, OAuthExchange } from "../connector";
import { MARKETPLACES, marketplaceByCode } from "./constants";
import { exchangeCode as lwaExchange } from "./lwa";
import { requestReport, REPORT_TYPE } from "./reports";
import { parseOrdersReport, parseInventoryReport, parseListingsReport } from "./mappers";
import { fetchCatalog } from "./catalog";

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
    authorizeUrl(state, marketplaceCode) {
      const appId = process.env.SPAPI_APP_ID;
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
  async fetchProducts(cred) {
    // The listings report ignores the date window; pass a wide range.
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    return parseListingsReport(await requestReport(cred, REPORT_TYPE.LISTINGS, { from, to }));
  },
  fetchCatalog(cred, asins) {
    return fetchCatalog(cred, asins);
  },
  async fetchOrders(cred, range) {
    return parseOrdersReport(await requestReport(cred, REPORT_TYPE.ORDERS, range));
  },
  async fetchInventory(cred) {
    // FBA ledger uses a date window; look back 30 days for the ending balance.
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return parseInventoryReport(await requestReport(cred, REPORT_TYPE.FBA_INVENTORY_LEDGER, { from, to }));
  },
};
