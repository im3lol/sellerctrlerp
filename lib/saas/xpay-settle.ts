import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptionRequests } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { fromMinorUnits, isCompleteStatus } from "./xpay";
import { activateFromRequest } from "@/lib/saas/subscription-activate";

/**
 * Activate the subscription a completed xpay checkout session settles. Matches the
 * session to its PENDING request (by the session id stashed in paymentReference, or by
 * the subscription_request_id metadata), guards the amount, and activates. Idempotent —
 * safe to call from BOTH the signed webhook and the return redirect.
 */
export async function settleXpaySession(input: { sessionId: string; status: string; amountMinor?: number; requestId?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isCompleteStatus(input.status)) return { ok: false, error: "الدفع غير مكتمل" };
  if (!input.sessionId && !input.requestId) return { ok: false, error: "لا يوجد معرّف" };
  return withPlatformScope(async () => {
    const [req] = await db.select({ id: subscriptionRequests.id }).from(subscriptionRequests).where(and(
      eq(subscriptionRequests.paymentMethod, "XPAY"),
      input.requestId ? eq(subscriptionRequests.id, input.requestId) : eq(subscriptionRequests.paymentReference, input.sessionId),
    )).limit(1);
    if (!req) return { ok: false, error: "الطلب غير موجود" };
    const paidAmount = input.amountMinor != null ? fromMinorUnits(input.amountMinor) : undefined;
    const r = await activateFromRequest(req.id, null, { paidAmount });
    return "ok" in r ? { ok: true } : { ok: false, error: r.error };
  });
}
