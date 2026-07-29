import { redirect } from "next/navigation";
import { getCheckoutSession } from "@/lib/saas/xpay";
import { settleXpaySession } from "@/lib/saas/xpay-settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where xpay redirects the tenant after checkout. The redirect alone isn't trusted —
 * we RETRIEVE the session server-side and settle if it's complete (belt-and-suspenders
 * alongside the signed webhook, which is the primary path). Activation is idempotent.
 */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("session_id") || "";
  let paid = false;
  if (id) {
    const session = await getCheckoutSession(id).catch(() => null);
    if (session) {
      const r = await settleXpaySession({ sessionId: session.id, status: session.status, amountMinor: session.amountTotal }).catch(() => ({ ok: false }));
      paid = r.ok;
    }
  }
  redirect(`/settings/subscription?xpay=${paid ? "paid" : "pending"}`);
}
