import type { MarketplaceOrder, MarketplaceInventory, MarketplaceInventoryDetail, MarketplaceProduct, MarketplaceInventoryUpdate, DateRange } from "./dto";
import type { OAuthState } from "./oauth-state";
import type { SettlementTxn } from "@/lib/erp/amazon-settlement";
import type { FbaReturnRow } from "@/lib/erp/amazon-returns";
import type { FbaReimbursementRow } from "@/lib/erp/amazon-reimbursements";
import type { FbaLedgerRow } from "@/lib/erp/amazon-ledger";
import type { RemovalRow } from "@/lib/erp/amazon-removals";
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

// Some providers only learn the seller's identity (Noon's project_code) from the token
// exchange itself, so exchangeCode may return it — the callback prefers these over the
// (possibly null) values from verifyCallback.
export type OAuthExchange =
  | { refreshToken: string; sellerId?: string | null; marketplaceId?: string | null; region?: string }
  | { error: string };

// Admin-editable integration config field. `key` maps to a platform_integrations column.
// `secret` fields are stored encrypted and never sent back to the browser (a blank input
// keeps the stored value). This lets /admin/integrations render a connector's whole config
// form generically — a new connector declares its fields and needs no new column/form.
export type IntegrationFieldKey =
  | "clientId" | "clientSecret" | "webhookSecret" | "redirectUri" | "scopes" | "region" | "apiVersion" | "appId";
export type IntegrationField = { key: IntegrationFieldKey; label: string; secret?: boolean; placeholder?: string; help?: string };

/**
 * One integration provider. A connector with an `oauth` block supports official
 * connection + automatic sync; without it, its platform is manual-import only.
 * Pull methods exist only when the matching capability is true.
 */
export interface MarketplaceConnector {
  code: string; // uppercase, matches sales_platforms.code + platform_credentials.provider
  label: string;
  capabilities: { products: boolean; catalog: boolean; orders: boolean; inventory: boolean; settlements: boolean };
  /** The credential/config fields the owner sets in /admin/integrations. Present ⇒ the
   *  generic integration form renders for this connector. An `oauth` block also adds a
   *  Redirect-URI section automatically. */
  configFields?: IntegrationField[];
  /** True → this provider's own token-invalid/auth error. Omitted → the sync core
   *  falls back to the Amazon isAuthError. Lets coreFail flag needsReauth per provider. */
  isAuthError?(e: unknown): boolean;
  oauth?: {
    marketplaces: ConnectorMarketplace[];
    /** Provider needs a merchant-supplied target (a Shopify shop domain) chosen at
     *  connect time instead of a fixed marketplace code — the connect route reads ?shop=. */
    needsTarget?: boolean;
    /** `target` = the chosen marketplace code (Amazon) OR the shop domain (Shopify).
     *  May be async (Shopify reads the app config to build the consent URL). */
    authorizeUrl(state: string, target: string): string | null | Promise<string | null>;
    /** `target` = shop domain for Shopify (its token endpoint is per-shop); Amazon ignores it. */
    exchangeCode(code: string, redirectUri: string, target?: string): Promise<OAuthExchange>;
    /** Verify + extract the auth code and seller identity from the callback query.
     *  Omitted → the route uses the built-in Amazon extraction (spapi_oauth_code +
     *  selling_partner_id). Shopify: HMAC-verify the query, confirm shop === state target.
     *  Async because HMAC needs the app secret (a DB config read). */
    verifyCallback?(params: URLSearchParams, state: OAuthState): Promise<
      | { code: string; sellerId: string | null; marketplaceId: string | null; region: string }
      | { error: string }
    >;
  };
  fetchProducts?(cred: Credential, since?: Date): Promise<MarketplaceProduct[]>;
  /** Complete catalog enumeration for the initial import (e.g. Amazon Reports API) —
   *  no result cap, but async/slow, so only ever called from a background worker. */
  fetchFullProducts?(cred: Credential): Promise<MarketplaceProduct[]>;
  fetchCatalog?(cred: Credential, asins: string[]): Promise<CatalogRecord[]>;
  fetchOrders?(cred: Credential, range: DateRange): Promise<MarketplaceOrder[]>;
  fetchInventory?(cred: Credential): Promise<MarketplaceInventory[]>;
  /** OPTIONAL write-back (P2.1): set the channel's available quantity for these SKUs, to stop
   *  the same SKU overselling across channels. Only connectors that support inventory WRITES
   *  implement it; the push is gated per-platform and OFF by default, and must be verified on
   *  a sandbox channel before any live account. Returns how many were pushed + per-SKU errors. */
  pushInventory?(cred: Credential, updates: MarketplaceInventoryUpdate[]): Promise<{ pushed: number; errors: { code: string; error: string }[] }>;
  /** Full FBA inventory breakdown per SKU (available/reserved/inbound/damaged/…) —
   *  the Inventory Auditor's data source. */
  fetchInventoryDetail?(cred: Credential): Promise<MarketplaceInventoryDetail[]>;
  /** Amazon settlement rows (ASIN-bucketed) pulled from the scheduled Settlement
   *  Report. Amazon-specific for now; feeds the settlement poster directly. */
  fetchSettlements?(cred: Credential, range: DateRange): Promise<SettlementTxn[]>;
  /** FBA customer returns in the window (returns report) — feeds the DRAFT-return sync. */
  fetchReturns?(cred: Credential, range: DateRange): Promise<FbaReturnRow[]>;
  /** FBA removal orders in the window (removal-order detail report) — stock out of the
   *  platform warehouse (Return → restock on receipt / Disposal → write-off). */
  fetchRemovals?(cred: Credential, range: DateRange): Promise<RemovalRow[]>;
  /** FBA reimbursements in the window (read-only feed). */
  fetchReimbursements?(cred: Credential, range: DateRange): Promise<FbaReimbursementRow[]>;
  /** FBA ledger detail events in the window (read-only feed). */
  fetchLedgerEvents?(cred: Credential, range: DateRange): Promise<FbaLedgerRow[]>;
  /** Estimated marketplace fees for SKUs at given prices (Product Fees API). */
  fetchFees?(cred: Credential, skus: { sku: string; price: number }[]): Promise<FeeEstimate[]>;
}
