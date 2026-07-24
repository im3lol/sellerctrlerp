import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials, syncRuns } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { enqueue, QUEUES } from "./queues";
import { incrementalFrom } from "@/lib/erp/marketplace/sync-core";

const DAY_MS = 24 * 60 * 60 * 1000;
// A RUNNING order/settlement sync older than this is treated as dead. Generous on
// purpose: the SP-API item pull is paced ~2s/order, so a few hundred orders is a
// legitimately >15-min run — reaping it early let the scheduler stack a SECOND
// concurrent sync for the same org (quota burn + duplicate work).
const STALE_MIN = 60;
const SETTLE_MS = 12 * 60 * 60 * 1000; // settlements settle ~biweekly → a slow (12h) check is plenty

/**
 * Enqueue the due sync jobs for every autoSync connection: an incremental
 * `amazon-orders` job every run (near-real-time order pickup) + a daily
 * `amazon-discovery` job when the product catalog is stale. Enqueue-only — the
 * worker does the SP-API work. Shared by the cron route and the worker timer.
 */
export async function enqueueDueSyncs(now = Date.now()): Promise<{ orders: number; discovery: number; settlements: number; total: number }> {
  return withPlatformScope(async () => {
    // Reap dead RUNNING order/settlement syncs (a crashed job never wrote its finish
    // row) so the dedup checks below don't block forever on a stuck run.
    await db.update(syncRuns).set({ status: "FAILED", finishedAt: new Date(), error: "توقّف غير متوقّع" })
      .where(and(inArray(syncRuns.kind, ["ORDERS", "SETTLEMENTS"]), eq(syncRuns.status, "RUNNING"),
        sql`${syncRuns.startedAt} < now() - interval '${sql.raw(String(STALE_MIN))} minutes'`));

    const creds = await db.select({
      orgId: platformCredentials.organizationId,
      provider: platformCredentials.provider,
      marketplaceId: platformCredentials.marketplaceId,
      productsSyncedAt: platformCredentials.productsSyncedAt,
      ordersSyncedAt: platformCredentials.ordersSyncedAt,
      settlementsSyncedAt: platformCredentials.settlementsSyncedAt,
      connectedAt: platformCredentials.connectedAt,
    }).from(platformCredentials)
      // needsReauth: the token is revoked — scheduling more jobs just burns LWA
      // calls and fills sync_runs with the same failure until the org reconnects.
      .where(and(eq(platformCredentials.autoSync, true), eq(platformCredentials.needsReauth, false)));

    // Is a RUNNING sync of `kind` already in flight for this org (within the stale window)?
    const isRunning = async (orgId: string, kind: string) => {
      const [r] = await db.select({ id: syncRuns.id }).from(syncRuns)
        .where(and(eq(syncRuns.organizationId, orgId), eq(syncRuns.kind, kind), eq(syncRuns.status, "RUNNING"),
          gt(syncRuns.startedAt, new Date(now - STALE_MIN * 60 * 1000)))).limit(1);
      return !!r;
    };

    let orders = 0, discovery = 0, settlements = 0;
    for (const c of creds) {
      const connectedAt = c.connectedAt ? new Date(c.connectedAt) : null;
      // Don't stack order jobs: skip if one is already running for this org (else a
      // slow/rate-limited sync piles up dozens of concurrent jobs that jam Amazon).
      if (!(await isRunning(c.orgId, "ORDERS"))) {
        const oSince = incrementalFrom(c.ordersSyncedAt ? new Date(c.ordersSyncedAt) : null, connectedAt, now).toISOString();
        if (await enqueue(QUEUES.orders, { orgId: c.orgId, provider: c.provider, marketplaceId: c.marketplaceId ?? undefined, since: oSince })) orders++;
      }

      const stale = !c.productsSyncedAt || now - new Date(c.productsSyncedAt).getTime() > 20 * (DAY_MS / 24);
      if (stale) {
        const pSince = c.productsSyncedAt ? incrementalFrom(new Date(c.productsSyncedAt), connectedAt, now).toISOString() : undefined;
        if (await enqueue(QUEUES.discovery, { orgId: c.orgId, provider: c.provider, marketplaceId: c.marketplaceId ?? undefined, since: pSince })) discovery++;
      }

      // Settlements: slow cadence (~biweekly settlement periods), same dedup as orders.
      const settleDue = !c.settlementsSyncedAt || now - new Date(c.settlementsSyncedAt).getTime() > SETTLE_MS;
      if (settleDue && !(await isRunning(c.orgId, "SETTLEMENTS"))) {
        const sSince = c.settlementsSyncedAt ? incrementalFrom(new Date(c.settlementsSyncedAt), connectedAt, now).toISOString() : undefined;
        if (await enqueue(QUEUES.settlements, { orgId: c.orgId, provider: c.provider, marketplaceId: c.marketplaceId ?? undefined, since: sSince })) settlements++;
      }
    }
    return { orders, discovery, settlements, total: creds.length };
  });
}

let timer: NodeJS.Timeout | null = null;

/**
 * Run enqueueDueSyncs on a timer inside the worker — near-real-time order pickup
 * with NO external scheduler (works on local Docker and any host). Idempotent.
 * ponytail: consecutive ticks may re-enqueue the same window before the prior job
 * bumps the watermark; runOrdersJob is idempotent (dup orders skipped), so harmless.
 */
export function startScheduler(intervalMs = 60_000): void {
  if (timer) return;
  const tick = () => enqueueDueSyncs().catch((e) => console.error("[scheduler] enqueue failed:", e));
  timer = setInterval(tick, intervalMs);
  void tick(); // fire once on boot
  console.log(`[scheduler] auto-sync every ${Math.round(intervalMs / 1000)}s`);
}
