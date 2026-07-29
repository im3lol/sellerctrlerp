import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptionRequests } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { getTransaction, isPaidStatus } from "./xpay";
import { activateFromRequest } from "@/app/actions/admin/subscription-requests";

/**
 * Verify an xpay transaction server-side and, if it's paid, activate the subscription
 * request it settles. The authoritative source of truth — never trust the callback body.
 * Idempotent (activateFromRequest no-ops an already-APPROVED request), so it's safe to
 * fire from BOTH the server-to-server callback and the browser return redirect.
 */
export async function settleXpaySubscription(uuid: string): Promise<{ ok: boolean; error?: string }> {
  if (!uuid) return { ok: false, error: "no uuid" };
  const txn = await getTransaction(uuid).catch(() => null);
  if (!txn || !isPaidStatus(txn.status)) return { ok: false, error: "غير مدفوع" };
  return withPlatformScope(async () => {
    const [req] = await db.select({ id: subscriptionRequests.id }).from(subscriptionRequests)
      .where(and(eq(subscriptionRequests.paymentReference, uuid), eq(subscriptionRequests.paymentMethod, "XPAY"))).limit(1);
    if (!req) return { ok: false, error: "الطلب غير موجود" };
    const r = await activateFromRequest(req.id, null, { paidAmount: txn.amount });
    return "ok" in r ? { ok: true } : { ok: false, error: r.error };
  });
}
