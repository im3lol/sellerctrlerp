import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesOrderLines, salesOrders, deliveryNotes, items } from "@/db/schema";
import { currentStock } from "@/lib/erp/inventory";
import { tryRecordAudit } from "@/lib/erp/audit";
import { createDeliveryFromOrderAction, confirmDeliveryAction, convertDeliveryToInvoiceAction, deleteDeliveryAction } from "@/app/actions/erp/deliveries";
import { postSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { cancelSalesOrderAction } from "@/app/actions/erp/sales-orders";

/** How far the automatic order flow takes a marketplace order. See sales_platforms.auto_mode. */
export type AutoMode = "order" | "deliver" | "invoice";

/** Notes prefix that marks a delivery parked as DRAFT because stock was short —
 *  what the "بانتظار المخزون" notification counts. Cleared implicitly once confirmed. */
export const STOCK_WAIT_MARK = "بانتظار توفّر المخزون";

export type FulfillResult =
  | { ok: true; deliveryId?: string; invoiceId?: string; noop?: boolean; drafted?: boolean; shortReason?: string }
  | { ok: false; blocked?: boolean; error: string };

/**
 * Run the document cycle for a CONFIRMED sales order, up to `opts.mode`:
 *   "order"   → nothing (order only)
 *   "deliver" → delivery note → confirm (stock OUT + COGS)
 *   "invoice" → + invoice → post (revenue + AR)   [default]
 *
 * If on-hand is short for ANY line: with `opts.draftOnShort` (the automatic
 * marketplace flow) the delivery is created but left as a DRAFT — never a
 * negative movement — an audit "بانتظار المخزون" entry is written, and it returns
 * { ok, drafted, shortReason }; a later sync reuses that same DRAFT (no
 * duplicate). Without it (a manual "run cycle" click) it returns { blocked }
 * with the shortfall, unchanged. The order must already be CONFIRMED.
 */
export async function fulfillOrder(orgId: string, orderId: string, opts: { mode?: AutoMode; draftOnShort?: boolean } = {}): Promise<FulfillResult> {
  const mode = opts.mode ?? "invoice";
  if (mode === "order") return { ok: true, noop: true }; // order-only: leave delivery/invoice to the user

  const lines = await db
    .select({ itemId: salesOrderLines.itemId, qty: salesOrderLines.quantity, delivered: salesOrderLines.deliveredQty, warehouseId: salesOrderLines.warehouseId, name: items.nameAr, code: items.code })
    .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, orderId));
  const pending = lines.map((l) => ({ ...l, remaining: Number(l.qty) - Number(l.delivered) })).filter((l) => l.remaining > 1e-9);
  if (pending.length === 0) return { ok: true, noop: true };

  // Reuse an existing DRAFT delivery for this order (idempotency: a prior short-stock
  // sync already parked one — don't create a second).
  const [existingDraft] = await db.select({ id: deliveryNotes.id, number: deliveryNotes.number })
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.salesOrderId, orderId), eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.status, "DRAFT")))
    .limit(1);

  // Stock pre-check — no negative. Warehouse must be set (FBA for Amazon).
  const short: string[] = [];
  for (const l of pending) {
    const label = l.name || l.code || l.itemId;
    if (!l.warehouseId) { short.push(`${label} (بدون مخزن)`); continue; }
    const { quantity } = await currentStock(orgId, l.itemId, l.warehouseId);
    if (quantity < l.remaining - 1e-9) short.push(`${label} (متاح ${quantity} / مطلوب ${l.remaining})`);
  }

  if (short.length) {
    const reason = short.join("، ");
    // Manual "run cycle": block with the shortfall (unchanged). Auto flow: park a DRAFT.
    if (!opts.draftOnShort) return { ok: false, blocked: true, error: `نقص مخزون: ${reason}` };
    // Park a DRAFT delivery + notify, instead of failing. Nothing posts.
    if (existingDraft) return { ok: true, deliveryId: existingDraft.id, drafted: true, shortReason: reason };
    const d = await createDeliveryFromOrderAction(orderId);
    if (!d.ok || !d.id) return { ok: false, error: d.error ?? "تعذّر إنشاء إذن الصرف" };
    await db.update(deliveryNotes).set({ notes: `${STOCK_WAIT_MARK} — ${reason}` })
      .where(and(eq(deliveryNotes.id, d.id), eq(deliveryNotes.organizationId, orgId)));
    await tryRecordAudit({
      orgId, userId: null, action: "CREATE", entityType: "DELIVERY_NOTE", entityId: d.id,
      summary: `إذن صرف مسودة بانتظار توفّر المخزون — نقص: ${reason}`,
    });
    return { ok: true, deliveryId: d.id, drafted: true, shortReason: reason };
  }

  // Stock is available — create (or reuse) the delivery and post it.
  let deliveryId = existingDraft?.id;
  let created = false;
  if (!deliveryId) {
    const d = await createDeliveryFromOrderAction(orderId);
    if (!d.ok || !d.id) return { ok: false, error: d.error ?? "تعذّر إنشاء إذن الصرف" };
    deliveryId = d.id; created = true;
  }
  const c = await confirmDeliveryAction(deliveryId);
  if (!c.ok) {
    if (created) await deleteDeliveryAction(deliveryId).catch(() => {});
    return { ok: false, blocked: true, error: c.error ?? "تعذّر تأكيد إذن الصرف" };
  }
  if (mode === "deliver") return { ok: true, deliveryId }; // stop at delivery — invoice manually
  const inv = await convertDeliveryToInvoiceAction(deliveryId);
  if (!inv.ok || !inv.invoiceId) return { ok: false, error: inv.error ?? "تعذّر إنشاء الفاتورة" };
  const p = await postSalesInvoiceAction(inv.invoiceId);
  if (!p.ok) return { ok: false, error: p.error ?? "تعذّر ترحيل الفاتورة" };
  return { ok: true, deliveryId, invoiceId: inv.invoiceId };
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
