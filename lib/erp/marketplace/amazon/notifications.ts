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

const NOTIFICATION_TYPE = "ORDER_CHANGE";

/**
 * Ensure the shared SQS destination exists + this seller has an ORDER_CHANGE
 * subscription pointing at it. Returns the ids to store on the credential.
 * Best-effort caller: never let a failure here break connect/sync.
 */
export async function ensureOrderNotifications(cred: Credential): Promise<{ destinationId: string; subscriptionId: string } | { error: string }> {
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
        body: JSON.stringify({ name: "sellerctrl-orders", resourceSpecification: { sqs: { arn } } }),
      });
      destinationId = created.payload?.destinationId;
    }
    if (!destinationId) return { error: "تعذّر إنشاء وجهة الإشعارات" };

    // 2) Subscription (seller token): reuse if present, else create.
    const sub = await spJson<SubscriptionResp>(cred, `/notifications/v1/subscriptions/${NOTIFICATION_TYPE}`).catch(() => null);
    let subscriptionId = sub?.payload?.subscriptionId;
    if (!subscriptionId) {
      const created = await spJson<SubscriptionResp>(cred, `/notifications/v1/subscriptions/${NOTIFICATION_TYPE}`, {
        method: "POST",
        body: JSON.stringify({ payloadVersion: "1.0", destinationId }),
      });
      subscriptionId = created.payload?.subscriptionId;
    }
    if (!subscriptionId) return { error: "تعذّر إنشاء الاشتراك" };
    return { destinationId, subscriptionId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "فشل إعداد الإشعارات" };
  }
}
