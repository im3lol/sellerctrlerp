"use server";

import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { items, customers, suppliers } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { itemMatches } from "@/lib/erp/item-match";

export type QuickHit = { id: string; code: string | null; name: string | null; href: string; kind: "item" | "customer" | "supplier" };

/**
 * The record half of the search bar: a few hits per type, live as you type.
 *
 * Deliberately the same matching /search uses — `itemMatches` for items (which knows
 * about SKU/ASIN/barcode codes, not just the name) and the same ilike for the two party
 * tables. A quick search that finds different things than the full search is worse than
 * having none: you stop trusting either.
 *
 * Five each. This runs on every keystroke, and a dropdown is for recognising the thing
 * you already had in mind, not for browsing.
 */
export async function quickSearchAction(query: string): Promise<QuickHit[]> {
  const q = query.trim();
  // Two characters is where a prefix stops matching most of the table.
  if (q.length < 2) return [];
  const { user, org } = await getActiveOrg();
  if (!user || !org) return [];

  return withOrgScope(org.id, false, async () => {
    const like = `%${q}%`;
    const [it, cu, su] = await Promise.all([
      db.select({ id: items.id, code: items.code, name: items.nameAr }).from(items)
        .where(and(eq(items.organizationId, org.id), itemMatches(org.id, q))).limit(5),
      db.select({ id: customers.id, code: customers.code, name: customers.nameAr }).from(customers)
        .where(and(eq(customers.organizationId, org.id), or(ilike(customers.nameAr, like), ilike(customers.code, like)))).limit(5),
      db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers)
        .where(and(eq(suppliers.organizationId, org.id), or(ilike(suppliers.nameAr, like), ilike(suppliers.code, like)))).limit(5),
    ]);
    return [
      ...it.map((r): QuickHit => ({ ...r, kind: "item", href: `/inventory/items/${r.id}` })),
      ...cu.map((r): QuickHit => ({ ...r, kind: "customer", href: "/sales/customers" })),
      ...su.map((r): QuickHit => ({ ...r, kind: "supplier", href: "/purchases/suppliers" })),
    ];
  });
}
