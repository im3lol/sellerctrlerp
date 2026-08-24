"use server";

import { and, desc, eq } from "drizzle-orm";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { db } from "@/lib/db";
import { unmatchedOrders } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";

// One parked order — the full marketplace order whose product SKU isn't linked to any item.
export type UnmatchedOrder = {
  id: string;
  channel: string;
  externalId: string;
  createdAt: string;
  lines: { code: string; altCode?: string; name?: string; qty: number; unitPrice: number; matched: boolean }[];
  total: number;
  status: string;
};

/** List the tenant's PENDING unmatched marketplace orders (unknown product), newest first. */
export async function getUnmatchedOrders(): Promise<UnmatchedOrder[]> {
  const auth = await authorizeErp("sales.view");
  if ("error" in auth) return [];
  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(unmatchedOrders)
      .where(and(eq(unmatchedOrders.organizationId, auth.orgId), eq(unmatchedOrders.status, "PENDING")))
      .orderBy(desc(unmatchedOrders.createdAt)).limit(500);
    return rows.map((r) => {
      const p = (r.payload ?? {}) as { total?: number; lines?: { code: string; altCode?: string; name?: string; qty: number; unitPrice: number; itemId?: string | null }[] };
      return {
        id: r.id, channel: r.channel, externalId: r.externalId, status: r.status,
        createdAt: (r.createdAt as Date).toISOString(),
        total: Number(p.total ?? 0),
        lines: (p.lines ?? []).map((l) => ({ code: l.code, altCode: l.altCode, name: l.name, qty: l.qty, unitPrice: l.unitPrice, matched: !!l.itemId })),
      };
    });
  });
}

/** Dismiss a parked order (mark RESOLVED) — used after the seller creates the product +
 *  order manually, or to ignore a junk order. A later sync also auto-resolves it once the
 *  product's code exists. */
export async function resolveUnmatchedAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    await db.update(unmatchedOrders).set({ status: "RESOLVED", updatedAt: new Date() })
      .where(and(eq(unmatchedOrders.organizationId, auth.orgId), eq(unmatchedOrders.id, id)));
    revalidatePath("/sales/orders/unmatched");
    return { ok: true };
  });
}
