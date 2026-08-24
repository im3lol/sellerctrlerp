import "server-only";
import { spJson, spJsonGrantless } from "./client";
import type { Credential } from "../connector";

// SP-API Notifications: ORDER_CHANGE pushed to ONE app-level SQS queue shared by
// every tenant (messages carry the SellerId; the worker routes them). Setup is
// idempotent: destination (grantless) then per-seller subscription (seller token).
// The SQS queue policy must allow SP-API principal arn:aws:iam::437568002678:root
// sqs:SendMessage — user-run infra, documented in .env.example.

export function sqsConfigured(): boolean {
  return !!(process.env.SPAPI_SQS_QUEUE_URL && process.env.SPAPI_SQS_QUEUE_ARN);
}

type DestinationList = { payload?: { destinationId?: string; resource?: { sqs?: { arn?: string } } }[] };
type DestinationResp = { payload?: { destinationId?: string } };
type SubscriptionResp = { payload?: { subscriptionId?: string } };

// Push instead of poll (the SP-API rate-limit doc's own advice). ORDER_CHANGE drives order
// sync; FBA_INVENTORY_AVAILABILITY_CHANGES drives an inventory reconcile; the others reduce
// polling once handlers land. Types the app lacks the role for just fail per-type (best-effort).
export const NOTIFICATION_TYPES = ["ORDER_CHANGE", "FBA_INVENTORY_AVAILABILITY_CHANGES", "REPORT_PROCESSING_FINISHED", "ANY_OFFER_CHANGED"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Idempotently ensure this seller is subscribed to one notification type → the shared
 *  destination. Returns the subscription id, or null on any failure (missing role, etc.). */
async function ensureSubscription(cred: Credential, type: string, destinationId: string): Promise<string | null> {
  const existing = await spJson<SubscriptionResp>(cred, `/notifications/v1/subscriptions/${type}`).catch(() => null);
  if (existing?.payload?.subscriptionId) return existing.payload.subscriptionId;
  const created = await spJson<SubscriptionResp>(cred, `/notifications/v1/subscriptions/${type}`, {
    method: "POST", body: JSON.stringify({ payloadVersion: "1.0", destinationId }),
  }).catch(() => null);
  return created?.payload?.subscriptionId ?? null;
}

/**
 * Ensure the shared SQS destination exists + this seller is subscribed to the given
 * notification types pointing at it. Each type is best-effort (a missing app role just
 * skips that type). Returns the destination id + the ORDER_CHANGE subscription id (the
 * one persisted on the credential + used as the backfill guard). Never throws upward.
 */
export async function ensureNotifications(cred: Credential, types: readonly string[] = NOTIFICATION_TYPES): Promise<{ destinationId: string; subscriptionId: string } | { error: string }> {
  const arn = process.env.SPAPI_SQS_QUEUE_ARN;
  if (!arn || !sqsConfigured()) return { error: "SQS غير مضبوط" };
  try {
    // 1) Destination (grantless, app-level): reuse if one already targets our ARN.
    let destinationId: string | undefined;
    const existing = await spJsonGrantless<DestinationList>(cred.region, `/notifications/v1/destinations`).catch(() => null);
    destinationId = existing?.payload?.find((d) => d.resource?.sqs?.arn === arn)?.destinationId;
    if (!destinationId) {
      const created = await spJsonGrantless<DestinationResp>(cred.region, `/notifications/v1/destinations`, {
        method: "POST",
        body: JSON.stringify({ name: "sellerctrl", resourceSpecification: { sqs: { arn } } }),
      });
      destinationId = created.payload?.destinationId;
    }
    if (!destinationId) return { error: "تعذّر إنشاء وجهة الإشعارات" };

    // 2) Subscribe each type (seller token), best-effort. ORDER_CHANGE is the primary id.
    let primary: string | null = null;
    for (const t of types) {
      const id = await ensureSubscription(cred, t, destinationId);
      if (id && (t === "ORDER_CHANGE" || !primary)) primary = id;
    }
    if (!primary) return { error: "تعذّر إنشاء الاشتراك" };
    return { destinationId, subscriptionId: primary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل إعداد الإشعارات" };
  }
}

/** Back-compat name — connect/backfill callers subscribe this seller to all types. */
export const ensureOrderNotifications = ensureNotifications;
