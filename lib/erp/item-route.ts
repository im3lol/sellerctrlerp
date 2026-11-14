import { notFound, redirect } from "next/navigation";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { UUID_RE } from "@/lib/erp/doc-route";
import { itemHref } from "@/lib/erp/item-href";

/** Call after the page permission guard, inside its tenant scope. Next params are
 * already decoded; decoding again would corrupt codes containing literal percent signs.
 * An exact code wins if it happens to look like a UUID. Legacy ids remain bookmarks,
 * but immediately replace themselves with the current code in the address bar. */
export async function itemCodeParam(raw: string, orgId: string, suffix: "" | "/edit" = "") {
  const [row] = await db.select({ code: items.code }).from(items).where(and(
    eq(items.organizationId, orgId),
    UUID_RE.test(raw) ? or(eq(items.code, raw), eq(items.id, raw)) : eq(items.code, raw),
  )).orderBy(sql`case when ${items.code} = ${raw} then 0 else 1 end`).limit(1);
  if (!row) notFound();
  if (row.code !== raw) redirect(itemHref(row.code, suffix));
  return row.code;
}
