import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { currencies } from "@/db/schema";

/**
 * Multi-currency helpers. The GL and all stored monetary amounts are always in
 * the org's BASE currency; a document's `currencyCode`/`exchangeRate`/`foreignAmount`
 * only preserve the original foreign figure for display and reconciliation.
 * `exchangeRate` means: 1 unit of the foreign currency = `rate` units of base.
 */

/** The org's base-currency code (falls back to "SAR" when none is flagged). */
export async function getBaseCurrencyCode(orgId: string): Promise<string> {
  const [base] = await db
    .select({ code: currencies.code })
    .from(currencies)
    .where(and(eq(currencies.organizationId, orgId), eq(currencies.isBase, true)))
    .limit(1);
  return base?.code ?? "SAR";
}

/**
 * Resolve the currency context for a document whose base total is `baseTotal`.
 * Returns the normalized code, a positive rate, and the foreign display amount
 * (base ÷ rate, 4dp) — or null foreignAmount when the document is in base currency.
 */
export function resolveCurrency(
  baseCode: string,
  currencyCode: string | undefined,
  exchangeRate: number | undefined,
  baseTotal: number,
): { code: string; rate: number; foreignAmount: number | null } {
  const code = (currencyCode ?? baseCode).toUpperCase();
  const isForeign = code !== baseCode.toUpperCase();
  const rate = isForeign && exchangeRate && exchangeRate > 0 ? exchangeRate : 1;
  const foreignAmount = isForeign ? Math.round((baseTotal / rate) * 10000) / 10000 : null;
  return { code, rate, foreignAmount };
}
