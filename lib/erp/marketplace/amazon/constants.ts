// SP-API region endpoints + the marketplaces a tenant can connect. The seller
// picks a marketplace at connect time; its region decides both the OAuth Seller
// Central domain and the API endpoint.

export type Region = "na" | "eu" | "fe";

export const SPAPI_ENDPOINT: Record<Region, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

// LWA token exchange is global (not region-specific).
export const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

export type Marketplace = {
  code: string;        // short slug used in the connect URL (?marketplace=EG)
  name: string;        // Arabic label
  marketplaceId: string;
  region: Region;
  sellerCentral: string; // OAuth consent domain for this marketplace
  currency: string;      // the marketplace's listing currency (fees estimates need it)
};

// MENA-first (most likely here), then common NA/EU.
export const MARKETPLACES: Marketplace[] = [
  { code: "EG", name: "مصر", marketplaceId: "ARBP9OOSHTCHU", region: "eu", sellerCentral: "https://sellercentral.amazon.eg", currency: "EGP" },
  { code: "AE", name: "الإمارات", marketplaceId: "A2VIGQ35RCS4UG", region: "eu", sellerCentral: "https://sellercentral.amazon.ae", currency: "AED" },
  { code: "SA", name: "السعودية", marketplaceId: "A17E79C6D8DWNP", region: "eu", sellerCentral: "https://sellercentral.amazon.sa", currency: "SAR" },
  { code: "US", name: "الولايات المتحدة", marketplaceId: "ATVPDKIKX0DER", region: "na", sellerCentral: "https://sellercentral.amazon.com", currency: "USD" },
  { code: "UK", name: "بريطانيا", marketplaceId: "A1F83G8C2ARO7P", region: "eu", sellerCentral: "https://sellercentral.amazon.co.uk", currency: "GBP" },
  { code: "DE", name: "ألمانيا", marketplaceId: "A1PA6795UKMFR9", region: "eu", sellerCentral: "https://sellercentral-europe.amazon.com", currency: "EUR" },
];

export function marketplaceByCode(code: string): Marketplace | undefined {
  return MARKETPLACES.find((m) => m.code === code.toUpperCase());
}
export function marketplaceById(id: string): Marketplace | undefined {
  return MARKETPLACES.find((m) => m.marketplaceId === id);
}
