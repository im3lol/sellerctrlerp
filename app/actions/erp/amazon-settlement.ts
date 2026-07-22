"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { marketplaceSettlementTxns } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { parseSettlementWorkbook, settlementDedupKey, type SettlementTxn } from "@/lib/erp/amazon-settlement";
import { aggregateGL, upsertSettlementTxns, postSettlements } from "@/lib/erp/settlement-core";
export type SettlementPreview =
  | {
      ok: true;
      total: number;
      newCount: number;
      byType: Record<string, number>;
      released: number;
      deferred: number;
      gl: { receivable: number; fees: number; bank: number; clearing: number; toPost: number };
    }
  | { ok: false; error: string };

export type SettlementResult =
  | {
      ok: true; imported: number; updated: number; posted: number; deferredHeld: number;
      returnsCreated: number; returnsUnmatched: string[]; journalNumber?: string;
      /**
       * AR credited in the GL that found no invoice to apply it against (the
       * settlement row was never matched to a sales order). This is the remaining
       * way GL 1103 and the customer subledger can drift, so it is reported
       * instead of being silently absorbed.
       */
      unlinkedReceivable?: number;
    }
  | { ok: false; error: string };

async function readTxns(formData: FormData): Promise<SettlementTxn[] | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ارفع ملف التسويات أولاً" };
  try {
    return parseSettlementWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
  }
}

export async function previewAmazonSettlementAction(formData: FormData): Promise<SettlementPreview> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const txns = await readTxns(formData);
    if ("error" in txns) return { ok: false, error: txns.error };

    const byType: Record<string, number> = {};
    for (const t of txns) byType[t.type] = (byType[t.type] || 0) + 1;
    const released = txns.filter((t) => t.status === "Released");
    const deferred = txns.length - released.length;

    // How many are new (not already imported by dedup key)?
    const keys = txns.map(settlementDedupKey);
    const existing = keys.length
      ? await db.select({ k: marketplaceSettlementTxns.dedupKey }).from(marketplaceSettlementTxns)
          .where(and(eq(marketplaceSettlementTxns.organizationId, auth.orgId), inArray(marketplaceSettlementTxns.dedupKey, keys)))
      : [];
    const existingKeys = new Set(existing.map((e) => e.k));
    const newCount = keys.filter((k) => !existingKeys.has(k)).length;

    const gl = aggregateGL(released);
    // Only released rows that are new OR not yet posted will actually post; for a
    // simple preview we show the full released aggregate.
    return {
      ok: true, total: txns.length, newCount, byType,
      released: released.length, deferred,
      gl: { ...gl, toPost: released.length },
    };
  });
}

/** Revalidate the pages a settlement post touches. */
function revalidateSettlement() {
  revalidatePath("/sales/orders");
  revalidatePath("/sales/orders/settlements");
  revalidatePath("/sales/invoices");
  revalidatePath("/sales/deliveries");
  revalidatePath("/accounting");
}

export async function runAmazonSettlementAction(formData: FormData): Promise<SettlementResult> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const txns = await readTxns(formData);
    if ("error" in txns) return { ok: false, error: txns.error };
    if (txns.length === 0) return { ok: false, error: "لا توجد معاملات في الملف" };

    const { imported, updated } = await upsertSettlementTxns(auth.orgId, txns);
    const posted = await postSettlements(auth.orgId, auth.userId);
    if ("error" in posted) return { ok: false, error: posted.error };
    revalidateSettlement();
    return {
      ok: true, imported, updated, posted: posted.posted, deferredHeld: posted.deferredHeld,
      returnsCreated: posted.returnsCreated, returnsUnmatched: posted.returnsUnmatched,
      unlinkedReceivable: posted.unlinkedReceivable,
    };
  });
}

/**
 * Post the already-pulled, released, not-yet-posted settlement rows to GL — the
 * manual-review path (the sync pulled rows without posting when auto-post is off).
 */
export async function postAmazonSettlementsAction(): Promise<SettlementResult> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const posted = await postSettlements(auth.orgId, auth.userId);
    if ("error" in posted) return { ok: false, error: posted.error };
    revalidateSettlement();
    return {
      ok: true, imported: 0, updated: 0, posted: posted.posted, deferredHeld: posted.deferredHeld,
      returnsCreated: posted.returnsCreated, returnsUnmatched: posted.returnsUnmatched,
      unlinkedReceivable: posted.unlinkedReceivable,
    };
  });
}
