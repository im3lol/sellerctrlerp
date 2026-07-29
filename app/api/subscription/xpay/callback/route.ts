import { settleXpaySubscription } from "@/lib/saas/xpay-settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extract xpay's transaction_uuid from the query, JSON body, or form body. */
async function extractUuid(req: Request): Promise<string> {
  const q = new URL(req.url).searchParams.get("transaction_uuid");
  if (q) return q;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const b = await req.json() as { transaction_uuid?: string; data?: { transaction_uuid?: string } };
      return b?.transaction_uuid || b?.data?.transaction_uuid || "";
    }
    const f = await req.formData();
    return String(f.get("transaction_uuid") || "");
  } catch { return ""; }
}

/**
 * xpay server-to-server callback. We DON'T trust the body: extract the uuid, then
 * verify + activate via getTransaction. Always 200 so xpay stops retrying (activation
 * is idempotent; a genuine failure is logged and reconciled on the return redirect).
 */
export async function POST(req: Request) {
  const uuid = await extractUuid(req);
  const r = await settleXpaySubscription(uuid).catch((e) => ({ ok: false, error: String(e) }));
  return Response.json({ received: true, activated: r.ok });
}
