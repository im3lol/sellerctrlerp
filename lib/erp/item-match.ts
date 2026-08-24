import { ilike, or, sql, type SQL } from "drizzle-orm";
import { items, itemCodes } from "@/db/schema";
import { normalizeCode } from "@/lib/erp/item-codes";

/**
 * "Find me this product" — the one definition of what an item search matches, so every
 * box in the app answers the same way.
 *
 * A trader does not hold one identifier for a product. The label carries a barcode, the
 * supplier's invoice carries their SKU, Amazon carries an ASIN, the carton carries an
 * EAN — and the internal code is the one number nobody outside the office knows. Typing
 * any of them, or part of the name, has to find the item; matching only `items.code`
 * meant scanning what was in front of you and being told the product does not exist.
 *
 * Every external identifier lives in `item_codes`, one row per code, already normalised
 * to A-Z0-9 (`normalizeCode`) — so a barcode typed with spaces or dashes still matches.
 * That is why the code half of this searches `normalized_code` and the name half does
 * not: names are matched as written, codes as scanned.
 *
 * EXISTS rather than fetching ids first: it composes into any query the caller is
 * already building, and Postgres plans it as a semi-join instead of a second round trip.
 *
 * Pass the ORG — `item_codes` is a tenant table and the subquery must be scoped, RLS or
 * no RLS.
 */
export function itemMatches(orgId: string, query: string): SQL | undefined {
  const q = query.trim();
  if (!q) return undefined;

  const conds: SQL[] = [
    ilike(items.code, `%${q}%`),
    ilike(items.nameAr, `%${q}%`),
  ];

  // Blank when the term is pure punctuation — then there is no code to look for.
  const norm = normalizeCode(q);
  if (norm) {
    conds.push(sql`EXISTS (
      SELECT 1 FROM ${itemCodes}
      WHERE ${itemCodes.itemId} = ${items.id}
        AND ${itemCodes.organizationId} = ${orgId}
        AND ${itemCodes.normalizedCode} LIKE ${`%${norm}%`}
    )`);
  }

  return or(...conds);
}
