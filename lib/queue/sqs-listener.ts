import "server-only";
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformCredentials } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { sqsConfigured, ensureOrderNotifications } from "@/lib/erp/marketplace/amazon/notifications";
import { decryptSecret } from "@/lib/crypto";
import { enqueue, QUEUES } from "./queues";

// Real-time ORDER_CHANGE listener: long-polls the shared SP-API SQS queue and
// turns each notification into a narrow incremental orders job for its tenant.
// Silently off unless SPAPI_SQS_QUEUE_URL/ARN + AWS creds are configured.
// ponytail: one listener loop, one worker replica; shard by queue if volume demands.

type SpNotification = {
  notificationType?: string;
  NotificationType?: string;
  payload?: { orderChangeNotification?: { sellerId?: string } };
  Payload?: { OrderChangeNotification?: { SellerId?: string } };
};

function sellerIdOf(n: SpNotification): string | null {
  return n.payload?.orderChangeNotification?.sellerId
    ?? n.Payload?.OrderChangeNotification?.SellerId
    ?? null;
}
function typeOf(n: SpNotification): string {
  return n.notificationType ?? n.NotificationType ?? "";
}

let started = false;

export function startSqsListener(): void {
  if (started || !sqsConfigured()) return;
  started = true;
  const queueUrl = process.env.SPAPI_SQS_QUEUE_URL!;
  const client = new SQSClient({}); // region/creds from the standard AWS env chain
  console.log("[sqs] ORDER_CHANGE listener started");

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
            const sellerId = typeOf(body) === "ORDER_CHANGE" ? sellerIdOf(body) : null;
            if (sellerId) {
              const [cred] = await withPlatformScope(() =>
                db.select({ orgId: platformCredentials.organizationId, provider: platformCredentials.provider, marketplaceId: platformCredentials.marketplaceId })
                  .from(platformCredentials).where(eq(platformCredentials.sellerId, sellerId)).limit(1));
              if (cred) {
                // Coalesce a burst of changes for one org into one job per minute
                // (a completed BullMQ jobId blocks re-adds, so the id carries a
                // minute bucket); runOrdersJob is idempotent anyway.
                await enqueue(QUEUES.orders, {
                  orgId: cred.orgId, provider: cred.provider, marketplaceId: cred.marketplaceId ?? undefined,
                  since: new Date(Date.now() - 60 * 60 * 1000).toISOString(), ordersMode: "updated",
                }, { jobId: `notif-${cred.orgId}-${Math.floor(Date.now() / 60_000)}`, delay: 15_000 });
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
