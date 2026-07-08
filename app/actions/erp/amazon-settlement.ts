"use server";

import { revalidatePath } from "next/cache";
import { round2 as r2 } from "@/lib/erp/money";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, salesOrders, marketplaceSettlementTxns, deliveryNotes, salesInvoices, salesInvoiceLines, itemCodes, items, stockMovements, bankAccounts } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { postEntry } from "@/lib/erp/posting";
import { currentStock } from "@/lib/erp/inventory";
import { returnFromSalesInvoiceAction, createDeliveryReturnAction, confirmSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { parseSettlementWorkbook, settlementDedupKey, type SettlementTxn } from "@/lib/erp/amazon-settlement";

const CHANNEL = "AMAZON";
export type SettlementPreview =
  | {
      ok: true;
      total: number;
      newCount: number;
      byType: Record<string, number>;
      released: number;
      deferred: number;
      gl: { receivable: number; fees: number; bank: number; clearing: number; toPost: number };
    }
  | { ok: false; error: string };

export type SettlementResult =
  | { ok: true; imported: number; updated: number; posted: number; deferredHeld: number; returnsCreated: number; returnsUnmatched: string[]; journalNumber?: string }
  | { ok: false; error: string };

async function readTxns(formData: FormData): Promise<SettlementTxn[] | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ارفع ملف التسويات أولاً" };
  try {
    return parseSettlementWorkbook(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
  }
}

/**
 * Aggregate released txns into the four GL movements (all balance to zero).
 * The order value is booked against Amazon RECEIVABLE (not revenue) — revenue
 * is recognized once, at the sales invoice; the settlement only collects that
 * receivable, so posting it to revenue again would double-count sales.
 */
function aggregateGL(rows: { type: string; productSales: number; shippingCredits: number; promotionalRebates: number; sellingFees: number; fbaFees: number; otherTransactionFees: number; other: number; total: number }[]) {
  let receivable = 0, fees = 0, bank = 0, clearing = 0;
  for (const t of rows) {
    clearing += t.total;
    if (t.type === "Order" || t.type === "Refund") {
      receivable += t.productSales + t.shippingCredits + t.promotionalRebates + t.other;
      fees += -(t.sellingFees + t.fbaFees + t.otherTransactionFees);
    } else if (t.type === "Transfer") {
      bank += -t.total;
    } else {
      // Service Fee / FBA Inventory Fee (expense) or SAFE-T reimbursement (offset).
      fees += -t.total;
    }
  }
  return { receivable: r2(receivable), fees: r2(fees), bank: r2(bank), clearing: r2(clearing) };
}

/** Get-or-create the Amazon clearing (asset) + Amazon fees (expense) accounts. */
async function ensureAmazonAccounts(orgId: string): Promise<{ clearing: string; fees: string; receivable: string; bank: string } | { error: string }> {
  const accs = await db.select({ id: accounts.id, code: accounts.code }).from(accounts).where(eq(accounts.organizationId, orgId));
  const byCode = new Map(accs.map((a) => [a.code, a.id]));
  const receivable = byCode.get("1103");
  const bank = byCode.get("1102");
  if (!receivable || !bank) return { error: "أنشئ دليل الحسابات القياسي أولاً (حسابات الذمم/البنك غير موجودة)" };

  let clearing = byCode.get("1108");
  if (!clearing) {
    const [r] = await db.insert(accounts).values({
      organizationId: orgId, code: "1108", nameAr: "رصيد أمازون الوسيط", type: "ASSET", normalBalance: "DEBIT",
      parentId: byCode.get("11") ?? null, isLeaf: true,
    }).returning({ id: accounts.id });
    clearing = r.id;
  }
  let fees = byCode.get("5203");
  if (!fees) {
    const [r] = await db.insert(accounts).values({
      organizationId: orgId, code: "5203", nameAr: "رسوم أمازون", type: "EXPENSE", normalBalance: "DEBIT",
      parentId: byCode.get("5") ?? null, isLeaf: true,
    }).returning({ id: accounts.id });
    fees = r.id;
  }
  return { clearing, fees, receivable, bank };
}

/** Map order ids in the file to existing Amazon sales orders. */
async function linkOrders(orgId: string, txns: SettlementTxn[]): Promise<Map<string, string>> {
  const ids = [...new Set(txns.map((t) => t.orderId).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: salesOrders.id, ext: salesOrders.externalOrderId }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, CHANNEL), inArray(salesOrders.externalOrderId, ids)));
  return new Map(rows.filter((r) => r.ext).map((r) => [r.ext as string, r.id]));
}

export async function previewAmazonSettlementAction(formData: FormData): Promise<SettlementPreview> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  const txns = await readTxns(formData);
  if ("error" in txns) return { ok: false, error: txns.error };

  const byType: Record<string, number> = {};
  for (const t of txns) byType[t.type] = (byType[t.type] || 0) + 1;
  const released = txns.filter((t) => t.status === "Released");
  const deferred = txns.length - released.length;

  // How many are new (not already imported by dedup key)?
  const keys = txns.map(settlementDedupKey);
  const existing = keys.length
    ? await db.select({ k: marketplaceSettlementTxns.dedupKey }).from(marketplaceSettlementTxns)
        .where(and(eq(marketplaceSettlementTxns.organizationId, auth.orgId), inArray(marketplaceSettlementTxns.dedupKey, keys)))
    : [];
  const existingKeys = new Set(existing.map((e) => e.k));
  const newCount = keys.filter((k) => !existingKeys.has(k)).length;

  const gl = aggregateGL(released);
  // Only released rows that are new OR not yet posted will actually post; for a
  // simple preview we show the full released aggregate.
  return {
    ok: true, total: txns.length, newCount, byType,
    released: released.length, deferred,
    gl: { ...gl, toPost: released.length },
  };
}

/**
 * For every not-yet-processed "Refund" settlement row, run the full return
 * cycle against the original Amazon order's posted invoice + delivery:
 *   • مرتجع فاتورة بيع (credit note) — reverse revenue + VAT + receivable.
 *   • مرتجع إذن صرف (delivery return) — restock at the delivery's cost + reverse
 *     COGS, and drop the order's deliveredQty (→ recomputes the order status =
 *     "مرتجع أمر بيع").
 * Idempotent: a Refund row is skipped once its `salesReturnId` is set. Refunds
 * that can't be matched (no order/invoice/item, or qty already returned) are
 * returned for the operator to handle, and never leave a partial reversal.
 */
async function processSettlementRefunds(orgId: string): Promise<{ created: number; unmatched: string[] }> {
  const refunds = await db.select({
    id: marketplaceSettlementTxns.id, orderId: marketplaceSettlementTxns.orderId,
    sku: marketplaceSettlementTxns.sku, quantity: marketplaceSettlementTxns.quantity,
    releaseDate: marketplaceSettlementTxns.releaseDate, postedAt: marketplaceSettlementTxns.postedAt,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.type, "Refund"),
    eq(marketplaceSettlementTxns.status, "Released"),
    isNull(marketplaceSettlementTxns.salesReturnId),
  ));
  if (refunds.length === 0) return { created: 0, unmatched: [] };

  let created = 0;
  const unmatched: string[] = [];
  const flag = (orderId: string | null, why: string) => unmatched.push(`${orderId || "?"} — ${why}`);

  for (const rf of refunds) {
    if (!rf.orderId) { flag(rf.orderId, "بدون رقم طلب"); continue; }
    const qty = Math.abs(Number(rf.quantity) || 0);
    if (qty <= 0) { flag(rf.orderId, "كمية المرتجع غير معروفة"); continue; }

    // Order → its delivery note → the posted invoice billed from it.
    const [order] = await db.select({ id: salesOrders.id }).from(salesOrders)
      .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, CHANNEL), eq(salesOrders.externalOrderId, rf.orderId))).limit(1);
    if (!order) { flag(rf.orderId, "لا يوجد أمر بيع مطابق"); continue; }
    const [dn] = await db.select({ id: deliveryNotes.id, warehouseId: deliveryNotes.warehouseId }).from(deliveryNotes)
      .where(and(eq(deliveryNotes.organizationId, orgId), eq(deliveryNotes.salesOrderId, order.id))).orderBy(desc(deliveryNotes.createdAt)).limit(1);
    if (!dn) { flag(rf.orderId, "لا يوجد إذن صرف"); continue; }
    const [inv] = await db.select({ id: salesInvoices.id }).from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.deliveryNoteId, dn.id), eq(salesInvoices.status, "POSTED"))).limit(1);
    if (!inv) { flag(rf.orderId, "لا توجد فاتورة مُرحّلة"); continue; }

    // Resolve the refunded SKU → item, then the invoice line to reverse at its price.
    const norm = normalizeCode(rf.sku || "");
    let itemId: string | null = null;
    if (norm) {
      const [code] = await db.select({ itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), eq(itemCodes.normalizedCode, norm))).limit(1);
      itemId = code?.itemId ?? null;
      if (!itemId) {
        const [it] = await db.select({ id: items.id }).from(items)
          .where(and(eq(items.organizationId, orgId), eq(items.code, rf.sku || ""))).limit(1);
        itemId = it?.id ?? null;
      }
    }
    if (!itemId) { flag(rf.orderId, `صنف غير معروف (${rf.sku || "?"})`); continue; }
    const [invLine] = await db.select({ unitPrice: salesInvoiceLines.unitPrice }).from(salesInvoiceLines)
      .where(and(eq(salesInvoiceLines.salesInvoiceId, inv.id), eq(salesInvoiceLines.itemId, itemId))).limit(1);
    if (!invLine) { flag(rf.orderId, "الصنف ليس على الفاتورة"); continue; }
    const unitPrice = Number(invLine.unitPrice);
    const date = (rf.releaseDate ?? rf.postedAt ?? new Date()).toISOString().slice(0, 10);

    // 1) Money-side credit note (invoice is delivery-sourced → this is money-only).
    const moneyRet = await returnFromSalesInvoiceAction(inv.id, [{ itemId, quantity: qty, unitPrice }], date);
    if (!moneyRet.ok || !moneyRet.id) { flag(rf.orderId, moneyRet.error || "تعذّر مرتجع الفاتورة"); continue; }

    // 2) Stock-side return off the delivery, restocked at the delivery's own cost.
    const [outMove] = await db.select({ unitCost: stockMovements.unitCost }).from(stockMovements)
      .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceId, dn.id), eq(stockMovements.itemId, itemId), eq(stockMovements.type, "OUT"))).limit(1);
    const restockCost = outMove ? Number(outMove.unitCost) : (await currentStock(orgId, itemId, dn.warehouseId)).avgCost;
    const stockRet = await createDeliveryReturnAction({ deliveryNoteId: dn.id, date, lines: [{ itemId, quantity: qty, unitPrice: restockCost }] });
    if (stockRet.ok && stockRet.id) {
      const conf = await confirmSalesReturnAction(stockRet.id);
      if (!conf.ok) flag(rf.orderId, `مرتجع الفاتورة تم، لكن تعذّر مرتجع المخزون: ${conf.error}`);
    } else {
      flag(rf.orderId, `مرتجع الفاتورة تم، لكن تعذّر إنشاء مرتجع المخزون: ${stockRet.ok ? "" : stockRet.error}`);
    }

    // Mark the refund row processed (keyed to the money credit note).
    await db.update(marketplaceSettlementTxns).set({ salesReturnId: moneyRet.id }).where(eq(marketplaceSettlementTxns.id, rf.id));
    created++;
  }
  return { created, unmatched };
}

export async function runAmazonSettlementAction(formData: FormData): Promise<SettlementResult> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return { ok: false, error: auth.error };
  const txns = await readTxns(formData);
  if ("error" in txns) return { ok: false, error: txns.error };
  if (txns.length === 0) return { ok: false, error: "لا توجد معاملات في الملف" };

  const accs = await ensureAmazonAccounts(auth.orgId);
  if ("error" in accs) return { ok: false, error: accs.error };

  // Unify under the AMAZON platform: route transfers to the platform's own bank
  // account (its GL account) when one is configured; otherwise keep default 1102.
  const plat = await ensureAmazonPlatform(auth.orgId);
  if (plat.bankAccountId) {
    const [ba] = await db.select({ gl: bankAccounts.glAccountId }).from(bankAccounts).where(eq(bankAccounts.id, plat.bankAccountId)).limit(1);
    if (ba?.gl) accs.bank = ba.gl;
  }

  const orderMap = await linkOrders(auth.orgId, txns);

  // Upsert every row (idempotent). On conflict, refresh status/release/link only.
  const values = txns.map((t) => ({
    organizationId: auth.orgId, channel: CHANNEL, settlementId: t.settlementId || null, type: t.type,
    orderId: t.orderId || null, sku: t.sku || null, description: t.description || null,
    quantity: String(t.quantity), postedAt: t.postedAt, status: t.status, releaseDate: t.releaseDate,
    productSales: String(t.productSales), shippingCredits: String(t.shippingCredits), promotionalRebates: String(t.promotionalRebates),
    sellingFees: String(t.sellingFees), fbaFees: String(t.fbaFees), otherTransactionFees: String(t.otherTransactionFees),
    other: String(t.other), total: String(t.total), dedupKey: settlementDedupKey(t),
    salesOrderId: (t.orderId && orderMap.get(t.orderId)) || null,
  }));

  const beforeCount = (await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(eq(marketplaceSettlementTxns.organizationId, auth.orgId)))[0]?.n ?? 0;

  // Chunk the upsert to keep parameter counts sane.
  for (let i = 0; i < values.length; i += 500) {
    await db.insert(marketplaceSettlementTxns).values(values.slice(i, i + 500)).onConflictDoUpdate({
      target: [marketplaceSettlementTxns.organizationId, marketplaceSettlementTxns.dedupKey],
      set: {
        status: sql`excluded.status`,
        releaseDate: sql`excluded.release_date`,
        salesOrderId: sql`coalesce(excluded.sales_order_id, ${marketplaceSettlementTxns.salesOrderId})`,
      },
    });
  }
  const afterCount = (await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(eq(marketplaceSettlementTxns.organizationId, auth.orgId)))[0]?.n ?? 0;
  const imported = Number(afterCount) - Number(beforeCount);
  const updated = txns.length - imported;

  // Post the released, not-yet-posted rows as one aggregated journal entry.
  const toPost = await db.select({
    id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type,
    productSales: marketplaceSettlementTxns.productSales, shippingCredits: marketplaceSettlementTxns.shippingCredits,
    promotionalRebates: marketplaceSettlementTxns.promotionalRebates, sellingFees: marketplaceSettlementTxns.sellingFees,
    fbaFees: marketplaceSettlementTxns.fbaFees, otherTransactionFees: marketplaceSettlementTxns.otherTransactionFees,
    other: marketplaceSettlementTxns.other, total: marketplaceSettlementTxns.total, releaseDate: marketplaceSettlementTxns.releaseDate,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, auth.orgId),
    eq(marketplaceSettlementTxns.status, "Released"),
    isNull(marketplaceSettlementTxns.journalEntryId),
  ));

  const deferredHeld = txns.filter((t) => t.status !== "Released").length;
  if (toPost.length === 0) {
    const ret0 = await processSettlementRefunds(auth.orgId);
    revalidatePath("/erp/sales/orders");
    revalidatePath("/erp/sales/invoices");
    revalidatePath("/erp/sales/deliveries");
    return { ok: true, imported, updated, posted: 0, deferredHeld, returnsCreated: ret0.created, returnsUnmatched: ret0.unmatched };
  }

  const rows = toPost.map((r) => ({
    type: r.type,
    productSales: Number(r.productSales), shippingCredits: Number(r.shippingCredits), promotionalRebates: Number(r.promotionalRebates),
    sellingFees: Number(r.sellingFees), fbaFees: Number(r.fbaFees), otherTransactionFees: Number(r.otherTransactionFees),
    other: Number(r.other), total: Number(r.total),
  }));
  const gl = aggregateGL(rows);
  const line = (accountId: string, amount: number, description: string) =>
    ({ accountId, debit: amount >= 0 ? amount : 0, credit: amount < 0 ? -amount : 0, description });
  const lines = [
    line(accs.clearing, gl.clearing, "صافي رصيد أمازون"),
    line(accs.fees, gl.fees, "رسوم أمازون (عمولة + FBA + أخرى)"),
    line(accs.bank, gl.bank, "تحويلات أمازون إلى البنك"),
    line(accs.receivable, -gl.receivable, "تحصيل ذمم أمازون (مقابل فواتير البيع)"),
  ].filter((l) => l.debit !== 0 || l.credit !== 0);

  const entryDate = toPost.reduce<Date | null>((mx, r) => {
    const d = r.releaseDate ? new Date(r.releaseDate) : null;
    return d && (!mx || d > mx) ? d : mx;
  }, null) ?? new Date();

  try {
    const journalId = await db.transaction(async (tx) => {
      const jid = await postEntry(tx, {
        orgId: auth.orgId, date: entryDate, sourceType: "AMAZON_SETTLEMENT",
        sourceId: `AMZ-${entryDate.toISOString()}-${toPost.length}`,
        description: `تسوية أمازون — ${toPost.length} معاملة (مُفرج عنها)`,
        userId: auth.userId, lines,
      });
      await tx.update(marketplaceSettlementTxns).set({ journalEntryId: jid })
        .where(inArray(marketplaceSettlementTxns.id, toPost.map((r) => r.id)));
      return jid;
    });
    void journalId;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "تعذّر ترحيل قيد التسوية" };
  }

  const ret = await processSettlementRefunds(auth.orgId);
  revalidatePath("/erp/sales/orders");
  revalidatePath("/erp/sales/invoices");
  revalidatePath("/erp/sales/deliveries");
  revalidatePath("/erp/accounting");
  return { ok: true, imported, updated, posted: toPost.length, deferredHeld, returnsCreated: ret.created, returnsUnmatched: ret.unmatched };
}
