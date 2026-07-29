import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { itemCodes } from "@/db/schema";

// The item_codes.codeType that carries each sales channel's own SKU.
export const CHANNEL_CODE_TYPE: Record<string, string> = { AMAZON: "ASIN", NOON: "NOON", SHOPIFY: "SHOPIFY" };

/**
 * Map itemId → the marketplace's own SKU (ASIN for Amazon, كود نون for Noon) for a
 * given sales channel. Empty for MANUAL/unknown channels or when no codes exist.
 * Keyed off the ORDER/INVOICE channel so a document shows the right marketplace code.
 */
export async function marketplaceCodesFor(
  orgId: string,
  channel: string | null | undefined,
  itemIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const codeType = channel ? CHANNEL_CODE_TYPE[channel] : undefined;
  if (!codeType || itemIds.length === 0) return out;
  const rows = await db.select({ itemId: itemCodes.itemId, code: itemCodes.code })
    .from(itemCodes)
    .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.codeType, codeType), inArray(itemCodes.itemId, itemIds)));
  for (const r of rows) if (!out.has(r.itemId)) out.set(r.itemId, r.code);
  return out;
}
