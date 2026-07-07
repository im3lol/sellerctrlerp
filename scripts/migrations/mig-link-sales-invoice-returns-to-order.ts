/**
 * One-off, idempotent: link existing sales invoice (money) returns to their originating
 * sales order (via invoice.deliveryNoteId → delivery.salesOrderId), so they also show as
 * sub-rows under the order. Returns of standalone invoices (no delivery) stay unlinked.
 * No GL change. New returns get this link automatically in createSalesReturnAction.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    UPDATE sales_returns sr
    SET sales_order_id = dn.sales_order_id
    FROM sales_invoices si
    JOIN delivery_notes dn ON dn.id = si.delivery_note_id
    WHERE sr.sales_invoice_id = si.id
      AND sr.sales_order_id IS NULL
      AND dn.sales_order_id IS NOT NULL`);
  console.log("sales invoice returns linked to order:", r.rowCount ?? 0);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
