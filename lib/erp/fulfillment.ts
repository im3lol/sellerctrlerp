import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrderLines, salesOrders, deliveryNotes, items } from "@/db/schema";
import { currentStock } from "@/lib/erp/inventory";
import { createDeliveryFromOrderAction, confirmDeliveryAction, convertDeliveryToInvoiceAction, deleteDeliveryAction } from "@/app/actions/erp/deliveries";
import { postSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { cancelSalesOrderAction } from "@/app/actions/erp/sales-orders";

export type FulfillResult =
  | { ok: true; deliveryId?: string; invoiceId?: string; noop?: boolean }
  | { ok: false; blocked?: boolean; error: string };

/**
 * Run the document cycle for a CONFIRMED sales order:
 *   delivery note → confirm (stock OUT + COGS) → [invoice → post (revenue + AR)].
 * With `opts.invoice === false` it stops at the posted delivery note (manual
 * invoicing). Pre-checks on-hand at each line's warehouse so it never creates a
 * negative movement; returns { blocked, error } (with the short items) instead.
 * The order must already be CONFIRMED (the caller confirms a DRAFT first).
 */
export async function fulfillOrder(orgId: string, orderId: string, opts: { invoice?: boolean } = {}): Promise<FulfillResult> {
  const invoice = opts.invoice ?? true;
  const lines = await db
    .select({ itemId: salesOrderLines.itemId, qty: salesOrderLines.quantity, delivered: salesOrderLines.deliveredQty, warehouseId: salesOrderLines.warehouseId, name: items.nameAr, code: items.code })
    .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, orderId));
  const pending = lines.map((l) => ({ ...l, remaining: Number(l.qty) - Number(l.delivered) })).filter((l) => l.remaining > 1e-9);
  if (pending.length === 0) return { ok: true, noop: true };

  // Stock pre-check — no negative. Warehouse must be set (FBA for Amazon).
  const short: string[] = [];
  for (const l of pending) {
    const label = l.name || l.code || l.itemId;
    if (!l.warehouseId) { short.push(`${label} (بدون مخزن)`); continue; }
    const { quantity } = await currentStock(orgId, l.itemId, l.warehouseId);
    if (quantity < l.remaining - 1e-9) short.push(`${label} (متاح ${quantity} / مطلوب ${l.remaining})`);
  }
  if (short.length) return { ok: false, blocked: true, error: `نقص مخزون: ${short.join("، ")}` };

  const d = await createDeliveryFromOrderAction(orderId);
  if (!d.ok || !d.id) return { ok: false, error: d.error ?? "تعذّر إنشاء إذن الصرف" };
  const c = await confirmDeliveryAction(d.id);
  if (!c.ok) {
    await deleteDeliveryAction(d.id).catch(() => {});
    return { ok: false, blocked: true, error: c.error ?? "تعذّر تأكيد إذن الصرف" };
  }
  if (!invoice) return { ok: true, deliveryId: d.id }; // stop at delivery — invoice manually
  const inv = await convertDeliveryToInvoiceAction(d.id);
  if (!inv.ok || !inv.invoiceId) return { ok: false, error: inv.error ?? "تعذّر إنشاء الفاتورة" };
  const p = await postSalesInvoiceAction(inv.invoiceId);
  if (!p.ok) return { ok: false, error: p.error ?? "تعذّر ترحيل الفاتورة" };
  return { ok: true, deliveryId: d.id, invoiceId: inv.invoiceId };
}

export type CancelResult = { ok: boolean; skipped?: boolean; error?: string };

/**
 * Tear down a marketplace order cancelled at the source: delete any un-posted
 * (DRAFT) delivery notes, then cancel the sales order — which flips it to
 * CANCELLED and releases its stock reservation (cancelled orders are excluded
 * from availability). An order that already posted stock/GL (DELIVERED/INVOICED)
 * is NOT cancelled here — that is a return, left for the return flow.
 */
export async function cancelMarketplaceOrder(orgId: string, soId: string): Promise<CancelResult> {
  const [so] = await db.select({ status: salesOrders.status }).from(salesOrders)
    .where(and(eq(salesOrders.id, soId), eq(salesOrders.organizationId, orgId))).limit(1);
  if (!so) return { ok: false, error: "الأمر غير موجود" };
  if (so.status === "CANCELLED") return { ok: true }; // already torn down — idempotent
  if (so.status !== "DRAFT" && so.status !== "CONFIRMED") return { ok: false, skipped: true }; // posted → return territory

  const drafts = await db.select({ id: deliveryNotes.id }).from(deliveryNotes)
    .where(and(eq(deliveryNotes.salesOrderId, soId), eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.status, "DRAFT")));
  for (const dn of drafts) await deleteDeliveryAction(dn.id).catch(() => {});

  const r = await cancelSalesOrderAction(soId);
  return { ok: !!r.ok, error: r.error };
}
