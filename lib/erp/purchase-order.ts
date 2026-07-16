import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const EPS = 1e-6;

/**
 * Recompute a purchase order's status from its lines' received/invoiced quantities.
 *
 * CANCELLED is terminal and is never overwritten — see recomputeSalesOrderStatus
 * for the reasoning; the receiving side has the same hazard.
 *
 * Returns the order's actual status after the call, not the computed one.
 */
export async function recomputePurchaseOrderStatus(tx: Tx, poId: string) {
  const lines = await tx.select({ q: purchaseOrderLines.quantity, r: purchaseOrderLines.receivedQty, inv: purchaseOrderLines.invoicedQty })
    .from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
  const allReceived = lines.every((l) => Number(l.r) >= Number(l.q) - EPS);
  const anyReceived = lines.some((l) => Number(l.r) > EPS);
  const allInvoiced = lines.every((l) => Number(l.inv) >= Number(l.q) - EPS);
  const status = allInvoiced ? "INVOICED" : allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "CONFIRMED";
  const updated = await tx.update(purchaseOrders).set({ status })
    .where(and(eq(purchaseOrders.id, poId), ne(purchaseOrders.status, "CANCELLED")))
    .returning({ status: purchaseOrders.status });
  return updated[0]?.status ?? "CANCELLED";
}
