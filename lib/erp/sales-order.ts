import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const EPS = 1e-6;

/**
 * Recompute a sales order's status from its lines' delivered/invoiced quantities.
 *
 * CANCELLED is terminal and is never overwritten — the derived status is a function
 * of the line quantities alone, so without this guard any path that moves a
 * quantity would resurrect a cancelled order (e.g. confirming a delivery drafted
 * before the cancellation would flip it back to DELIVERED). The callers block that
 * at source; this is the backstop, and it covers all of them at once.
 *
 * Returns the order's actual status after the call, not the computed one.
 */
export async function recomputeSalesOrderStatus(tx: Tx, soId: string) {
  const lines = await tx.select({ q: salesOrderLines.quantity, d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
  const allDelivered = lines.every((l) => Number(l.d) >= Number(l.q) - EPS);
  const anyDelivered = lines.some((l) => Number(l.d) > EPS);
  const allInvoiced = lines.every((l) => Number(l.inv) >= Number(l.q) - EPS);
  const status = allInvoiced ? "INVOICED" : allDelivered ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : "CONFIRMED";
  const updated = await tx.update(salesOrders).set({ status })
    .where(and(eq(salesOrders.id, soId), ne(salesOrders.status, "CANCELLED")))
    .returning({ status: salesOrders.status });
  return updated[0]?.status ?? "CANCELLED";
}
