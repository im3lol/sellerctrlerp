import "server-only";
import type { MarketplaceConnector, ConnectorMarketplace, OAuthExchange } from "../connector";
import { MARKETPLACES, marketplaceByCode } from "./constants";
import { exchangeCode as lwaExchange } from "./lwa";

const marketplaces: ConnectorMarketplace[] = MARKETPLACES.map((m) => ({
  code: m.code, name: m.name, region: m.region, marketplaceId: m.marketplaceId,
}));

/** Amazon SP-API connector (first real MarketplaceConnector). */
export const amazonConnector: MarketplaceConnector = {
  code: "AMAZON",
  label: "أمازون",
  capabilities: { orders: true, inventory: true, settlements: true },
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
  // fetchOrders/fetchInventory wired in Phase 3 (SP-API Reports client).
};
