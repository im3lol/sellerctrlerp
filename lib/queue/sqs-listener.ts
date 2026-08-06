import "server-only";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { sqsConfigured, ensureOrderNotifications } from "@/lib/erp/marketplace/amazon/notifications";
import { decryptSecret } from "@/lib/crypto";
import { enqueue, QUEUES } from "./queues";

// Real-time SP-API notification listener: long-polls the shared queue and turns each
// push into the right per-tenant job — ORDER_CHANGE → incremental orders,
// FBA_INVENTORY_AVAILABILITY_CHANGES → inventory reconcile. Replaces polling loops.
// Silently off unless SPAPI_SQS_QUEUE_URL/ARN + AWS creds are configured.
// ponytail: one listener loop, one worker replica; shard by queue if volume demands.

type SpNotification = { notificationType?: string; NotificationType?: string; [k: string]: unknown };

function typeOf(n: SpNotification): string {
  return n.notificationType ?? n.NotificationType ?? "";
}

/** Find the seller id anywhere in the notification body (payload shapes differ per type).
 *  Depth-limited recursive scan for a sellerId/SellerId string. */
function findSellerId(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if ((k === "sellerId" || k === "SellerId") && typeof v === "string" && v) return v;
    if (v && typeof v === "object") { const found = findSellerId(v, depth + 1); if (found) return found; }
  }
  return null;
}

let started = false;

export function startSqsListener(): void {
  if (started || !sqsConfigured()) return;
  started = true;
  const queueUrl = process.env.SPAPI_SQS_QUEUE_URL!;
  const client = new SQSClient({}); // region/creds from the standard AWS env chain
  console.log("[sqs] SP-API notification listener started (orders + FBA inventory)");

  // Lazy backfill: connections made before SQS was configured get subscribed on
  // worker boot (idempotent; failures just retry next boot).
  void withPlatformScope(async () => {
    const missing = await db.select().from(platformCredentials)
      .where(eq(platformCredentials.provider, "amazon"));
    for (const c of missing) {
      if (c.notifSubscriptionId || c.needsReauth) continue;
      const refreshToken = decryptSecret(c.refreshToken);
      if (!refreshToken) continue;
      const r = await ensureOrderNotifications({ refreshToken, sellerId: c.sellerId, marketplaceId: c.marketplaceId, region: c.region });
      if (!("error" in r)) {
        await db.update(platformCredentials)
          .set({ notifDestinationId: r.destinationId, notifSubscriptionId: r.subscriptionId, updatedAt: new Date() })
          .where(eq(platformCredentials.id, c.id));
      }
    }
  }).catch((e) => console.error("[sqs] subscription backfill failed:", e));

  void (async () => {
    for (;;) {
      try {
        const res = await client.send(new ReceiveMessageCommand({
          QueueUrl: queueUrl, WaitTimeSeconds: 20, MaxNumberOfMessages: 10,
        }));
        for (const msg of res.Messages ?? []) {
          try {
            const body = JSON.parse(msg.Body ?? "{}") as SpNotification;
            const type = typeOf(body);
            const sellerId = findSellerId(body);
            if (sellerId && (type === "ORDER_CHANGE" || type === "FBA_INVENTORY_AVAILABILITY_CHANGES")) {
              const [cred] = await withPlatformScope(() =>
                db.select({ orgId: platformCredentials.organizationId, provider: platformCredentials.provider, marketplaceId: platformCredentials.marketplaceId })
                  .from(platformCredentials).where(eq(platformCredentials.sellerId, sellerId)).limit(1));
              if (cred) {
                const bucket = Math.floor(Date.now() / 60_000); // coalesce a burst into one job/min
                const base = { orgId: cred.orgId, provider: cred.provider, marketplaceId: cred.marketplaceId ?? undefined };
                if (type === "ORDER_CHANGE") {
                  // runOrdersJob is idempotent; the minute-bucket jobId blocks re-adds.
                  await enqueue(QUEUES.orders, { ...base, since: new Date(Date.now() - 60 * 60 * 1000).toISOString(), ordersMode: "updated" },
                    { jobId: `notif-orders-${cred.orgId}-${bucket}`, delay: 15_000 });
                } else {
                  // FBA stock shifted → refresh the read-only Inventory Auditor snapshot.
                  await enqueue(QUEUES.inventory, base, { jobId: `notif-inv-${cred.orgId}-${bucket}`, delay: 30_000 });
                }
              }
            }
          } catch (e) {
            console.error("[sqs] bad notification message (dropped):", e instanceof Error ? e.message : e);
          }
          // Always delete — unknown sellers / parse failures are poison otherwise.
          if (msg.ReceiptHandle) {
            await client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle })).catch(() => {});
          }
        }
      } catch (e) {
        console.error("[sqs] receive failed, retrying in 30s:", e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  })();
}
