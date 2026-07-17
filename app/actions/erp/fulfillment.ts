"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { fulfillOrder } from "@/lib/erp/fulfillment";

/**
 * Run the full cycle for a CONFIRMED sales order in one click:
 * delivery note → confirm → sales invoice → post. Blocked (no negative stock)
 * returns the shortfall message.
 */
export async function fulfillOrderAction(orderId: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.confirm");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
      .where(and(eq(salesOrders.id, orderId), eq(salesOrders.organizationId, auth.orgId))).limit(1);
    if (!so) return { error: "الأمر غير موجود" };
    if (so.status === "DRAFT") return { error: "أكّد الأمر أولاً قبل تنفيذ الدورة" };
    if (so.status === "CANCELLED" || so.status === "INVOICED") return { error: "الأمر غير قابل للتنفيذ في حالته الحالية" };

    const f = await fulfillOrder(auth.orgId, orderId);
    if (!f.ok) return { error: f.error };
    revalidatePath("/erp/sales/orders");
    revalidatePath(`/erp/sales/orders/${encodeURIComponent(so.number)}`);
    return { ok: true };
  });
}
