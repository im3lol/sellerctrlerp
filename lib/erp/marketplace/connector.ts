import type { MarketplaceOrder, MarketplaceInventory, MarketplaceSettlement, MarketplaceProduct, DateRange } from "./dto";

// A decrypted connection for one tenant+provider (refresh token already decrypted).
export type Credential = {
  refreshToken: string;
  sellerId: string | null;
  marketplaceId: string | null;
  region: string;
};

// A marketplace the seller can pick when connecting (region decides the API + OAuth domain).
export type ConnectorMarketplace = { code: string; name: string; region: string; marketplaceId: string };

export type OAuthExchange = { refreshToken: string } | { error: string };

/**
 * One integration provider. A connector with an `oauth` block supports official
 * connection + automatic sync; without it, its platform is manual-import only.
 * Pull methods exist only when the matching capability is true.
 */
export interface MarketplaceConnector {
  code: string; // uppercase, matches sales_platforms.code + platform_credentials.provider
  label: string;
  capabilities: { products: boolean; orders: boolean; inventory: boolean; settlements: boolean };
  oauth?: {
    marketplaces: ConnectorMarketplace[];
    authorizeUrl(state: string, marketplaceCode: string): string | null;
    exchangeCode(code: string, redirectUri: string): Promise<OAuthExchange>;
  };
  fetchProducts?(cred: Credential): Promise<MarketplaceProduct[]>;
  fetchOrders?(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]>;
  fetchInventory?(cred: Credential): Promise<MarketplaceInventory[]>;
  fetchSettlements?(cred: Credential, range: DateRange): Promise<MarketplaceSettlement[]>;
}
