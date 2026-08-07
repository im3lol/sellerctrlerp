import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceProduct, MarketplaceInventory } from "../dto";
import { jumiaCall, scArray } from "./client";

// Jumia SellerCenter GetProducts → neutral rows. Each product carries a SellerSku (the match
// key) and per-product Quantity (available stock). Variable products expose ProductData +
// nested Variations; we flatten to one row per SellerSku.

export type JumiaProduct = {
  SellerSku?: string;
  ShopSku?: string;
  Name?: string;
  Price?: string | number;
  Quantity?: string | number;
  Available?: string | number;
};
type GetProductsBody = { Products?: { Product?: JumiaProduct | JumiaProduct[] } };

const num = (v: unknown) => Number(v ?? 0) || 0;

/** Pure: Jumia product → MarketplaceProduct. */
export function productToProduct(p: JumiaProduct): MarketplaceProduct {
  return {
    code: (p.SellerSku || "").trim() || (p.ShopSku || "").trim(),
    altCode: p.ShopSku || undefined,
    name: p.Name || p.SellerSku || "",
    sellPrice: num(p.Price),
  };
}

/** Pure: Jumia product → inventory row, or null when it has no SKU to reconcile against. */
export function productToInventory(p: JumiaProduct): MarketplaceInventory | null {
  const code = (p.SellerSku || "").trim();
  if (!code) return null;
  return { code, title: p.Name || code, onHand: num(p.Available ?? p.Quantity) };
}

export async function fetchProducts(cred: Credential, since?: Date): Promise<MarketplaceProduct[]> {
  const extra: Record<string, string> = { Limit: "100" };
  if (since) extra.UpdatedAfter = since.toISOString();
  const body = await jumiaCall<GetProductsBody>(cred, "GetProducts", extra);
  return scArray(body.Products?.Product).map(productToProduct).filter((p) => p.code);
}

export const fetchFullProducts = (cred: Credential) => fetchProducts(cred);

export async function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  const body = await jumiaCall<GetProductsBody>(cred, "GetProducts", { Limit: "100" });
  return scArray(body.Products?.Product)
    .map(productToInventory)
    .filter((x): x is MarketplaceInventory => x !== null);
}
