/**
 * One-off, idempotent: link existing invoice (money) returns to their originating purchase
 * order (via invoice.goodsReceiptId → receipt.purchaseOrderId), so they also show as sub-rows
 * under the order. Returns of standalone invoices (no receipt) stay unlinked. No GL change.
 * New returns get this link automatically in createPurchaseReturnAction.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    UPDATE purchase_returns pr
    SET purchase_order_id = rc.purchase_order_id
    FROM purchase_invoices pi
    JOIN purchase_receipts rc ON rc.id = pi.goods_receipt_id
    WHERE pr.purchase_invoice_id = pi.id
      AND pr.purchase_order_id IS NULL
      AND rc.purchase_order_id IS NOT NULL`);
  console.log("invoice returns linked to order:", r.rowCount ?? 0);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
