import type { MarketplaceOrder, MarketplaceInventory, MarketplaceInventoryDetail, MarketplaceProduct, DateRange } from "./dto";
import type { SettlementTxn } from "@/lib/erp/amazon-settlement";
import type { FbaReturnRow } from "@/lib/erp/amazon-returns";
import type { FbaReimbursementRow } from "@/lib/erp/amazon-reimbursements";
import type { FbaLedgerRow } from "@/lib/erp/amazon-ledger";
import type { FeeEstimate } from "@/lib/erp/marketplace/amazon/fees";

// A decrypted connection for one tenant+provider (refresh token already decrypted).
export type Credential = {
  refreshToken: string;
  sellerId: string | null;
  marketplaceId: string | null;
  region: string;
};

// A marketplace the seller can pick when connecting (region decides the API + OAuth domain).
export type ConnectorMarketplace = { code: string; name: string; region: string; marketplaceId: string };

// Enrichment data for one product, pulled from a marketplace catalog by ASIN.
export type CatalogIdentifier = { type: string; code: string }; // e.g. { type: "UPC", code: "..." }
export type CatalogRecord = {
  asin: string;
  imageUrl?: string;
  brand?: string;
  weight?: string;       // display string, e.g. "0.5 kg"
  dimensions?: string;   // display string, e.g. "10 × 5 × 3 cm"
  name?: string;
  identifiers: CatalogIdentifier[];
  parentAsin?: string;   // set on a variation child
  variationValue?: string; // e.g. "Red / L"
  category?: string;     // browse-node leaf display name → item category
};

export type OAuthExchange = { refreshToken: string } | { error: string };

/**
 * One integration provider. A connector with an `oauth` block supports official
 * connection + automatic sync; without it, its platform is manual-import only.
 * Pull methods exist only when the matching capability is true.
 */
export interface MarketplaceConnector {
  code: string; // uppercase, matches sales_platforms.code + platform_credentials.provider
  label: string;
  capabilities: { products: boolean; catalog: boolean; orders: boolean; inventory: boolean; settlements: boolean };
  oauth?: {
    marketplaces: ConnectorMarketplace[];
    authorizeUrl(state: string, marketplaceCode: string): string | null;
    exchangeCode(code: string, redirectUri: string): Promise<OAuthExchange>;
  };
  fetchProducts?(cred: Credential, since?: Date): Promise<MarketplaceProduct[]>;
  /** Complete catalog enumeration for the initial import (e.g. Amazon Reports API) —
   *  no result cap, but async/slow, so only ever called from a background worker. */
  fetchFullProducts?(cred: Credential): Promise<MarketplaceProduct[]>;
  fetchCatalog?(cred: Credential, asins: string[]): Promise<CatalogRecord[]>;
  fetchOrders?(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]>;
  fetchInventory?(cred: Credential): Promise<MarketplaceInventory[]>;
  /** Full FBA inventory breakdown per SKU (available/reserved/inbound/damaged/…) —
   *  the Inventory Auditor's data source. */
  fetchInventoryDetail?(cred: Credential): Promise<MarketplaceInventoryDetail[]>;
  /** Amazon settlement rows (ASIN-bucketed) pulled from the scheduled Settlement
   *  Report. Amazon-specific for now; feeds the settlement poster directly. */
  fetchSettlements?(cred: Credential, range: DateRange): Promise<SettlementTxn[]>;
  /** FBA customer returns in the window (returns report) — feeds the DRAFT-return sync. */
  fetchReturns?(cred: Credential, range: DateRange): Promise<FbaReturnRow[]>;
  /** FBA reimbursements in the window (read-only feed). */
  fetchReimbursements?(cred: Credential, range: DateRange): Promise<FbaReimbursementRow[]>;
  /** FBA ledger detail events in the window (read-only feed). */
  fetchLedgerEvents?(cred: Credential, range: DateRange): Promise<FbaLedgerRow[]>;
  /** Estimated marketplace fees for SKUs at given prices (Product Fees API). */
  fetchFees?(cred: Credential, skus: { sku: string; price: number }[]): Promise<FeeEstimate[]>;
}
