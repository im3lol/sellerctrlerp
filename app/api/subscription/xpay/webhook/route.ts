import { getXpayConfig, verifyWebhookSignature } from "@/lib/saas/xpay";
import { settleXpaySession } from "@/lib/saas/xpay-settle";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * xpay webhook — the authoritative payment confirmation. Verify the XPay-Signature
 * over the RAW body before trusting anything, then on checkout.session.completed
 * activate the subscription the session settles. Idempotent.
 *
 * 400 on a bad/missing signature. 200 once the event is handled. **500 when settling
 * fails** — this used to swallow the error and answer 200 anyway, which told xpay the
 * payment was recorded and stopped its retries: a customer could pay and never be
 * activated, with nothing in any log. Settling is idempotent, so letting xpay retry is
 * safe, and the error now reaches the owner's alert channel.
 */
export async function POST(req: Request) {
  const cfg = await getXpayConfig();
  const raw = await req.text();
  const now = Math.floor(Date.now() / 1000);
  if (!cfg?.webhookSecret || !verifyWebhookSignature(raw, req.headers.get("XPay-Signature"), cfg.webhookSecret, now)) {
    return new Response("invalid signature", { status: 400 });
  }
  let event: { type?: string; data?: { object?: { id?: string; status?: string; amountTotal?: number; metadata?: Record<string, string> } } };
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  if (event.type === "checkout.session.completed") {
    const o = event.data?.object ?? {};
    try {
      await settleXpaySession({
        sessionId: o.id ?? "", status: o.status ?? "", amountMinor: o.amountTotal,
        requestId: o.metadata?.subscription_request_id,
      });
    } catch (err) {
      log.error("xpay.settle_failed", { sessionId: o.id, requestId: o.metadata?.subscription_request_id, err });
      return new Response("settle failed", { status: 500 });
    }
  }
  return Response.json({ received: true });
}
