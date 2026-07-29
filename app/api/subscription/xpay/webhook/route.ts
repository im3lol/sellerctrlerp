import { getXpayConfig, verifyWebhookSignature } from "@/lib/saas/xpay";
import { settleXpaySession } from "@/lib/saas/xpay-settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * xpay webhook — the authoritative payment confirmation. Verify the XPay-Signature
 * over the RAW body before trusting anything, then on checkout.session.completed
 * activate the subscription the session settles. Idempotent. Always 200 on a verified
 * event so xpay stops retrying; 400 on a bad/missing signature.
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
    await settleXpaySession({
      sessionId: o.id ?? "", status: o.status ?? "", amountMinor: o.amountTotal,
      requestId: o.metadata?.subscription_request_id,
    }).catch(() => null);
  }
  return Response.json({ received: true });
}
