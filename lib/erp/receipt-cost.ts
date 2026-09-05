import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { purchaseReceiptLines, purchaseOrderLines } from "@/db/schema";
import { round2 } from "@/lib/erp/money";

type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReceiptLineCost = {
  itemId: string;
  warehouseId: string;
  quantity: number;
  /** Cost ONE unit entered stock at on this receipt. */
  unitNet: number;
  /** quantity × unitNet — what this line credited to GRNI (2103). */
  value: number;
};

/**
 * What a goods receipt actually capitalised, per line.
 *
 * THE definition of a received unit's cost: price and discount come from the ORDER line
 * (that is what was agreed), shipping from the RECEIPT line (each delivery can carry its
 * own freight). This mirrors `confirmReceiptAction`'s `unitNet`
 * (app/actions/erp/goods-receipts.ts) — the two must stay identical, because the receipt
 * credits GRNI with this figure and the invoice debits GRNI with it. If they drift,
 * 2103 silently stops clearing and /purchases/grni starts showing a difference.
 *
 * Everything that needs "what did this receipt cost" reads it from here: the invoice's
 * three-way match, the purchase-return price cap, the GRNI reconciliation, and the
 * receipt's own all-in cost view.
 */
export async function receiptLineCosts(
  exec: Exec,
  grn: { id: string; purchaseOrderId: string | null; warehouseId: string },
): Promise<ReceiptLineCost[]> {
  const grnLines = await exec
    .select({
      itemId: purchaseReceiptLines.itemId,
      quantity: purchaseReceiptLines.quantity,
      warehouseId: purchaseReceiptLines.warehouseId,
      shippingPerUnit: purchaseReceiptLines.shippingPerUnit,
    })
    .from(purchaseReceiptLines)
    .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));

  const poByItem = new Map<string, { unitPrice: number; discountAmount: number; quantity: number }>();
  if (grn.purchaseOrderId) {
    const poLines = await exec
      .select({
        itemId: purchaseOrderLines.itemId,
        unitPrice: purchaseOrderLines.unitPrice,
        discountAmount: purchaseOrderLines.discountAmount,
        quantity: purchaseOrderLines.quantity,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, grn.purchaseOrderId));
    for (const p of poLines) {
      poByItem.set(p.itemId, { unitPrice: Number(p.unitPrice), discountAmount: Number(p.discountAmount), quantity: Number(p.quantity) });
    }
  }

  return grnLines
    .map((gl) => {
      const quantity = Number(gl.quantity);
      const pol = poByItem.get(gl.itemId);
      const unitNet = pol
        ? pol.unitPrice - pol.discountAmount / (pol.quantity || 1) + Number(gl.shippingPerUnit)
        : Number(gl.shippingPerUnit);
      return {
        itemId: gl.itemId,
        warehouseId: gl.warehouseId || grn.warehouseId,
        quantity,
        unitNet,
        value: round2(quantity * unitNet),
      };
    })
    .filter((l) => l.quantity > 0);
}
