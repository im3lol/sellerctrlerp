import { redirect } from "next/navigation";
import { settleXpaySubscription } from "@/lib/saas/xpay-settle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where xpay redirects the tenant after paying. Belt-and-suspenders: try to settle
 * here too (in case the server-to-server callback was delayed/dropped), then send them
 * back to the subscription page with a status flag. Activation is idempotent.
 */
export async function GET(req: Request) {
  const uuid = new URL(req.url).searchParams.get("transaction_uuid") || "";
  const r = uuid ? await settleXpaySubscription(uuid).catch(() => ({ ok: false })) : { ok: false };
  redirect(`/settings/subscription?xpay=${r.ok ? "paid" : "pending"}`);
}
