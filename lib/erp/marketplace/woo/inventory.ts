import "server-only";
import type { Credential } from "../connector";
import type { MarketplaceInventory } from "../dto";
import { wcPaginate } from "./client";
import type { WooProduct } from "./products";

// Ending on-hand per seller SKU for a warehouse reconciliation (read-only). Only products
// that manage stock report a quantity; SKU-less products can't reconcile and are dropped.

/** Pure: WC product → inventory row, or null when it can't reconcile (no SKU or no managed stock). */
export function productToInventory(p: WooProduct): MarketplaceInventory | null {
  const code = (p.sku || "").trim();
  if (!code) return null;
  if (p.manage_stock === false || p.stock_quantity == null) return null;
  return { code, title: p.name, onHand: Number(p.stock_quantity) || 0 };
}

export const productsToInventory = (rows: WooProduct[]): MarketplaceInventory[] =>
  rows.map(productToInventory).filter((x): x is MarketplaceInventory => x !== null);

export async function fetchInventory(cred: Credential): Promise<MarketplaceInventory[]> {
  const rows = await wcPaginate<WooProduct>(cred, "products", { status: "publish" });
  return productsToInventory(rows);
}
