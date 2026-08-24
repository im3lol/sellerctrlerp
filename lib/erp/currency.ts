import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { currencies, exchangeRates } from "@/db/schema";

/**
 * Multi-currency helpers. The GL and all stored monetary amounts are always in
 * the org's BASE currency; a document's `currencyCode`/`exchangeRate`/`foreignAmount`
 * only preserve the original foreign figure for display and reconciliation.
 * `exchangeRate` means: 1 unit of the foreign currency = `rate` units of base.
 */

/**
 * Rate to convert 1 unit of `code` into the org's base currency, as of `date`:
 * the newest exchange_rates row on/before that date, else the currency's snapshot
 * rate, else 0 — the caller treats 0 as "no rate on file" and refuses to post.
 * The base currency (or a blank code) always returns 1.
 */
export async function getExchangeRate(orgId: string, code: string, baseCode: string, date: Date): Promise<number> {
  const c = (code ?? "").toUpperCase();
  if (!c || c === baseCode.toUpperCase()) return 1;
  const [r] = await db.select({ rate: exchangeRates.rate }).from(exchangeRates)
    .where(and(eq(exchangeRates.organizationId, orgId), eq(exchangeRates.currencyCode, c), lte(exchangeRates.date, date)))
    .orderBy(desc(exchangeRates.date)).limit(1);
  if (r && Number(r.rate) > 0) return Number(r.rate);
  const [snap] = await db.select({ rate: currencies.exchangeRate }).from(currencies)
    .where(and(eq(currencies.organizationId, orgId), eq(currencies.code, c))).limit(1);
  return snap && Number(snap.rate) > 0 ? Number(snap.rate) : 0;
}

/** The org's base-currency code (falls back to "EGP" when none is flagged). */
export async function getBaseCurrencyCode(orgId: string): Promise<string> {
  const [base] = await db
    .select({ code: currencies.code })
    .from(currencies)
    .where(and(eq(currencies.organizationId, orgId), eq(currencies.isBase, true)))
    .limit(1);
  return base?.code ?? "EGP";
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
