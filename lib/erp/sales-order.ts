import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const EPS = 1e-6;

/** Recompute a sales order's status from its lines' delivered/invoiced quantities. */
export async function recomputeSalesOrderStatus(tx: Tx, soId: string) {
  const lines = await tx.select({ q: salesOrderLines.quantity, d: salesOrderLines.deliveredQty, inv: salesOrderLines.invoicedQty })
    .from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, soId));
  const allDelivered = lines.every((l) => Number(l.d) >= Number(l.q) - EPS);
  const anyDelivered = lines.some((l) => Number(l.d) > EPS);
  const allInvoiced = lines.every((l) => Number(l.inv) >= Number(l.q) - EPS);
  const status = allInvoiced ? "INVOICED" : allDelivered ? "DELIVERED" : anyDelivered ? "PARTIALLY_DELIVERED" : "CONFIRMED";
  await tx.update(salesOrders).set({ status }).where(eq(salesOrders.id, soId));
  return status;
}
