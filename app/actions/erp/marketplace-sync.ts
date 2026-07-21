"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { syncRuns } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { enqueue, QUEUES } from "@/lib/queue/queues";
import { redisEnabled } from "@/lib/queue/redis";
import {
  prepareSync, markSync, syncOrdersCore, syncInventoryCore, syncSettlementsCore,
  startProductSync, getProductSyncState,
  type OrdersSync, type InventorySync, type ProductSyncStatus,
} from "@/lib/erp/marketplace/sync-core";


const LOOKBACK_DAYS = 30;

// No outer withOrgScope here: a sync interleaves multi-second SP-API fetches with
// DB writes, so wrapping the whole action would pin one DB connection for the
// entire sync. Instead prepareSync/markSync and the *Core functions each self-scope
// their DB work (RLS-isolated), and fetches run unscoped — connection released.

/**
 * Step 1 — start the product-catalog sync IN THE BACKGROUND and return at once.
 * A full pull (11k+ SKUs + catalog enrichment) runs for minutes, longer than a
 * browser request survives, so the client kicks it off here and polls
 * productsSyncStatusAction. Progress/result live server-side, independent of the
 * client connection.
 */
export async function syncProductsAction(code: string): Promise<{ ok: boolean; error?: string; running?: boolean }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.products) return { ok: false, error: "مزامنة المنتجات موقوفة لهذه المنصّة" };
  // Prefer the queue (a worker runs the full Reports-API import + logs to sync_runs);
  // fall back to the in-process runner when Redis isn't configured (local host dev).
  if (await enqueue(QUEUES.import, { orgId: p.orgId, provider: p.provider, marketplaceId: p.cred.marketplaceId ?? undefined })) {
    return { ok: true, running: true };
  }
  const { started, alreadyRunning } = startProductSync(p);
  return { ok: true, running: started || alreadyRunning };
}

/** Poll the background product sync; the UI calls this every few seconds. Reads the
 *  latest sync_runs row (queue path) and falls back to the in-process Map. */
export async function productsSyncStatusAction(code: string): Promise<ProductSyncStatus> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { phase: "idle" };
  const provider = code.toLowerCase();

  if (redisEnabled()) {
    const [row] = await withOrgScope(auth.orgId, false, () =>
      db.select().from(syncRuns)
        .where(and(eq(syncRuns.organizationId, auth.orgId), eq(syncRuns.provider, provider), eq(syncRuns.kind, "IMPORT")))
        .orderBy(desc(syncRuns.startedAt)).limit(1));
    if (row) {
      const phase = row.status === "OK" ? "done" : row.status === "FAILED" ? "error" : "running";
      if (phase !== "running") revalidatePath("/inventory/items");
      return { phase, total: row.productsProcessed, created: row.newProducts, linked: row.updatedProducts, error: row.error ?? undefined };
    }
    return { phase: "running" }; // enqueued, worker hasn't written the row yet
  }

  const st = getProductSyncState(auth.orgId, provider);
  if (st?.phase === "done" || st?.phase === "error") revalidatePath("/inventory/items");
  if (!st) return { phase: "idle" };
  const r = st.result && st.result.ok ? st.result : undefined;
  return { phase: st.phase, total: r?.total, created: r?.created, linked: r?.linked, error: st.result && !st.result.ok ? st.result.error : undefined };
}

/** Step 2 — sync sales (orders) through the sales-order cycle. `since` (YYYY-MM-DD)
 *  lets the user pick the start date; omitted → last 30 days. */
export async function syncOrdersAction(code: string, since?: string): Promise<OrdersSync> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.orders) return { ok: false, error: "مزامنة المبيعات موقوفة لهذه المنصّة" };
  const to = new Date();
  const parsed = since ? new Date(since) : null;
  const from = parsed && !isNaN(parsed.getTime()) ? parsed : new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const r = await syncOrdersCore(p, auth.userId, { from, to });
  if (r.ok) await markSync(p.orgId, p.provider, { lastSyncStatus: "ok", ordersSyncedAt: to });
  revalidatePath("/sales/orders");
  return r;
}

/** Start a background sales sync (date-picked / manual backfill) and return at
 *  once; the UI polls ordersSyncStatusAction and shows a progress popup like the
 *  other syncs. Falls back to an inline run when Redis isn't configured. */
export async function startOrdersSyncAction(code: string, since?: string): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.orders) return { ok: false, error: "مزامنة المبيعات موقوفة لهذه المنصّة" };
  const parsed = since ? new Date(since) : null;
  const from = parsed && !isNaN(parsed.getTime()) ? parsed : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Manual backfill from a chosen date → CreatedAfter (all orders placed since then).
  if (await enqueue(QUEUES.orders, { orgId: p.orgId, provider: p.provider, marketplaceId: p.cred.marketplaceId ?? undefined, since: from.toISOString(), ordersMode: "created" })) {
    return { ok: true, started: true };
  }
  const r = await syncOrdersCore(p, auth.userId, { from, to: new Date(), mode: "created" }); // inline fallback (no Redis)
  if (!r.ok) return { ok: false, error: r.error };
  await markSync(p.orgId, p.provider, { lastSyncStatus: "ok", ordersSyncedAt: new Date() });
  revalidatePath("/sales/orders");
  return { ok: true, started: false };
}

/** Poll the background sales sync (latest ORDERS sync_run). */
export async function ordersSyncStatusAction(code: string): Promise<{ phase: "running" | "done" | "error" | "idle"; created?: number; error?: string }> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { phase: "idle" };
  const provider = code.toLowerCase();
  const [row] = await withOrgScope(auth.orgId, false, () =>
    db.select().from(syncRuns)
      .where(and(eq(syncRuns.organizationId, auth.orgId), eq(syncRuns.provider, provider), eq(syncRuns.kind, "ORDERS")))
      .orderBy(desc(syncRuns.startedAt)).limit(1));
  if (!row) return { phase: "running" }; // enqueued; worker hasn't written its row yet
  const phase = row.status === "OK" ? "done" : row.status === "FAILED" ? "error" : "running";
  return { phase, created: row.newProducts ?? undefined, error: row.error ?? undefined };
}

/** Pull the scheduled Amazon settlement reports (payments) now. Enqueues a worker
 *  job (which upserts + optionally auto-posts) or runs inline when Redis is absent.
 *  Posting to GL still follows the platform's auto-post toggle. */
export async function syncSettlementsAction(code: string): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.settlements) return { ok: false, error: "مزامنة التسويات موقوفة لهذه المنصّة" };
  const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // settlement reports carry ~2 weeks; a wide floor + dedup is safe
  if (await enqueue(QUEUES.settlements, { orgId: p.orgId, provider: p.provider, marketplaceId: p.cred.marketplaceId ?? undefined, since: from.toISOString() })) {
    return { ok: true, started: true };
  }
  const r = await syncSettlementsCore(p, { from, to: new Date() }); // inline fallback (no Redis)
  if (!r.ok) return { ok: false, error: r.error };
  await markSync(p.orgId, p.provider, { lastSyncStatus: "ok", settlementsSyncedAt: new Date() });
  revalidatePath("/platforms");
  return { ok: true, started: false };
}

/** Poll the background settlement pull (latest SETTLEMENTS sync_run). */
export async function settlementsSyncStatusAction(code: string): Promise<{ phase: "running" | "done" | "error" | "idle"; imported?: number; posted?: number; error?: string }> {
  const auth = await authorizeErp("accounting.create", "marketplace");
  if ("error" in auth) return { phase: "idle" };
  const provider = code.toLowerCase();
  const [row] = await withOrgScope(auth.orgId, false, () =>
    db.select().from(syncRuns)
      .where(and(eq(syncRuns.organizationId, auth.orgId), eq(syncRuns.provider, provider), eq(syncRuns.kind, "SETTLEMENTS")))
      .orderBy(desc(syncRuns.startedAt)).limit(1));
  if (!row) return { phase: "running" };
  const phase = row.status === "OK" ? "done" : row.status === "FAILED" ? "error" : "running";
  if (phase !== "running") revalidatePath("/platforms");
  return { phase, imported: row.newProducts ?? undefined, posted: row.updatedProducts ?? undefined, error: row.error ?? undefined };
}

/** Step 3 — reconcile inventory (read-only preview; confirmed separately). */
export async function syncInventoryAction(code: string): Promise<InventorySync> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.inventory) return { ok: false, error: "مزامنة المخزون موقوفة لهذه المنصّة" };
  const r = await syncInventoryCore(p);
  revalidatePath(`/platforms/${p.provider}`);
  return r;
}
