import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { enqueue, QUEUES } from "./queues";
import { incrementalFrom } from "@/lib/erp/marketplace/sync-core";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Enqueue the due sync jobs for every autoSync connection: an incremental
 * `amazon-orders` job every run (near-real-time order pickup) + a daily
 * `amazon-discovery` job when the product catalog is stale. Enqueue-only — the
 * worker does the SP-API work. Shared by the cron route and the worker timer.
 */
export async function enqueueDueSyncs(now = Date.now()): Promise<{ orders: number; discovery: number; total: number }> {
  return withPlatformScope(async () => {
    const creds = await db.select({
      orgId: platformCredentials.organizationId,
      provider: platformCredentials.provider,
      marketplaceId: platformCredentials.marketplaceId,
      productsSyncedAt: platformCredentials.productsSyncedAt,
      ordersSyncedAt: platformCredentials.ordersSyncedAt,
      connectedAt: platformCredentials.connectedAt,
    }).from(platformCredentials).where(eq(platformCredentials.autoSync, true));

    let orders = 0, discovery = 0;
    for (const c of creds) {
      const connectedAt = c.connectedAt ? new Date(c.connectedAt) : null;
      const oSince = incrementalFrom(c.ordersSyncedAt ? new Date(c.ordersSyncedAt) : null, connectedAt, now).toISOString();
      if (await enqueue(QUEUES.orders, { orgId: c.orgId, provider: c.provider, marketplaceId: c.marketplaceId ?? undefined, since: oSince })) orders++;

      const stale = !c.productsSyncedAt || now - new Date(c.productsSyncedAt).getTime() > 20 * (DAY_MS / 24);
      if (stale) {
        const pSince = c.productsSyncedAt ? incrementalFrom(new Date(c.productsSyncedAt), connectedAt, now).toISOString() : undefined;
        if (await enqueue(QUEUES.discovery, { orgId: c.orgId, provider: c.provider, marketplaceId: c.marketplaceId ?? undefined, since: pSince })) discovery++;
      }
    }
    return { orders, discovery, total: creds.length };
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
