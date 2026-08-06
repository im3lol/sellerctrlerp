import "server-only";
import { createHash } from "crypto";
import { round2 as r2 } from "@/lib/erp/money";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts, salesOrders, marketplaceSettlementTxns, deliveryNotes, salesInvoices,
  salesInvoiceLines, itemCodes, items, stockMovements, bankAccounts, customers, salesReturns, journalEntries, journalEntryLines, salesPlatforms,
} from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry } from "@/lib/erp/posting";
import { currentStock } from "@/lib/erp/inventory";
import { createSalesReturnAction, createDeliveryReturnAction, confirmSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { ensurePlatform, ensurePlatformWalletGl } from "@/lib/erp/platform-provision";
import { settlementDedupKey, type SettlementTxn } from "@/lib/erp/amazon-settlement";
import { splitSettlementRows, perOrderGL, nonOrderGL, orderReceivable, type SettleAmounts } from "@/lib/erp/settlement-gl";
import { bust, orgKey } from "@/lib/cache";

// Session-less settlement engine shared by the file-upload action, the SP-API sync
// job, and the manual "post" button. All functions assume the caller already
// established the org RLS scope (withOrgScope) — they do no auth of their own.
//
// Multi-channel: every function takes a `channel` (default "AMAZON" for backward
// compatibility) and filters marketplace_settlement_txns.channel by it, so posting
// one channel never touches another's rows. Only the wallet GL, journal sourceType,
// and descriptions differ per channel; the double-entry logic is identical.

type ChannelCfg = { label: string; walletCode: string; walletName: string; sourceType: string; srcPrefix: string };
const CHANNELS: Record<string, ChannelCfg> = {
  AMAZON: { label: "أمازون", walletCode: "1109", walletName: "محفظة أمازون", sourceType: "AMAZON_SETTLEMENT", srcPrefix: "AMZ" },
  SHOPIFY: { label: "شوبيفاي", walletCode: "1110", walletName: "محفظة شوبيفاي", sourceType: "SHOPIFY_SETTLEMENT", srcPrefix: "SHOP" },
};
const channelCfg = (channel: string): ChannelCfg => CHANNELS[channel] ?? CHANNELS.AMAZON;

/**
 * Aggregate released txns into the four GL movements (all balance to zero).
 * The order value is booked against Amazon RECEIVABLE (not revenue) — revenue
 * is recognized once, at the sales invoice; the settlement only collects that
 * receivable, so posting it to revenue again would double-count sales.
 */
export function aggregateGL(rows: { type: string; productSales: number; shippingCredits: number; promotionalRebates: number; sellingFees: number; fbaFees: number; otherTransactionFees: number; other: number; total: number }[]) {
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

/** Get-or-create the Amazon clearing (asset) + Amazon fees (expense) accounts.
 *  Resolves the org's configured accounts (receivable/bank/clearing/fees) via the
 *  override layer; only creates 1108/5203 with default codes when neither an
 *  override nor an existing account is found. */
async function ensureAmazonAccounts(orgId: string): Promise<{ clearing: string; fees: string; receivable: string; bank: string } | { error: string }> {
  const ov = await resolveAccountIds(orgId, ["1103", "1102", "1108", "5203"]);
  const receivable = ov["1103"];
  const bank = ov["1102"];
  if (!receivable || !bank) return { error: "أنشئ دليل الحسابات القياسي أولاً (حسابات الذمم/البنك غير موجودة)" };

  let clearing = ov["1108"];
  let fees = ov["5203"];
  if (!clearing || !fees) {
    // Only load the rollup parents when we actually need to create an account.
    const parents = await db.select({ id: accounts.id, code: accounts.code }).from(accounts)
      .where(and(eq(accounts.organizationId, orgId), inArray(accounts.code, ["11", "5"])));
    const byCode = new Map(parents.map((a) => [a.code, a.id]));
    if (!clearing) {
      const [r] = await db.insert(accounts).values({
        organizationId: orgId, code: "1108", nameAr: "رصيد أمازون الوسيط", type: "ASSET", normalBalance: "DEBIT",
        parentId: byCode.get("11") ?? null, isLeaf: true,
      }).returning({ id: accounts.id });
      clearing = r.id;
    }
    if (!fees) {
      const [r] = await db.insert(accounts).values({
        organizationId: orgId, code: "5203", nameAr: "رسوم أمازون", type: "EXPENSE", normalBalance: "DEBIT",
        parentId: byCode.get("5") ?? null, isLeaf: true,
      }).returning({ id: accounts.id });
      fees = r.id;
    }
  }
  return { clearing, fees, receivable, bank };
}

/** Map order ids in the file to existing sales orders on this channel. */
async function linkOrders(orgId: string, txns: SettlementTxn[], channel: string): Promise<Map<string, string>> {
  const ids = [...new Set(txns.map((t) => t.orderId).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: salesOrders.id, ext: salesOrders.externalOrderId }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, channel), inArray(salesOrders.externalOrderId, ids)));
  return new Map(rows.filter((r) => r.ext).map((r) => [r.ext as string, r.id]));
}

/**
 * For every not-yet-processed "Refund" settlement row, run the full return
 * cycle against the original Amazon order's posted invoice + delivery:
 *   • مرتجع فاتورة بيع (credit note) — reverse revenue + VAT + receivable.
 *   • مرتجع إذن صرف (delivery return) — restock at the delivery's cost + reverse
 *     COGS, and drop the order's deliveredQty (→ recomputes the order status).
 * Idempotent: a Refund row is skipped once its `salesReturnId` is set.
 */
async function processSettlementRefunds(orgId: string, channel: string): Promise<{ created: number; unmatched: string[] }> {
  // Resume claimed-but-unposted refunds from a crashed run: salesReturnId was
  // stamped but the credit note is still DRAFT — confirm it now (idempotent).
  const stuck = await db.select({ retId: salesReturns.id })
    .from(marketplaceSettlementTxns)
    .innerJoin(salesReturns, eq(salesReturns.id, marketplaceSettlementTxns.salesReturnId))
    .where(and(
      eq(marketplaceSettlementTxns.organizationId, orgId),
      eq(marketplaceSettlementTxns.channel, channel),
      eq(marketplaceSettlementTxns.type, "Refund"),
      eq(salesReturns.status, "DRAFT"),
    ));
  for (const s of stuck) await confirmSalesReturnAction(s.retId).catch(() => {});

  const refunds = await db.select({
    id: marketplaceSettlementTxns.id, orderId: marketplaceSettlementTxns.orderId,
    sku: marketplaceSettlementTxns.sku, quantity: marketplaceSettlementTxns.quantity,
    releaseDate: marketplaceSettlementTxns.releaseDate, postedAt: marketplaceSettlementTxns.postedAt,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.channel, channel),
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
      .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, channel), eq(salesOrders.externalOrderId, rf.orderId))).limit(1);
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
    //    Claim-first: create the DRAFT, stamp salesReturnId, THEN confirm — a crash
    //    after the old create+confirm but before the stamp re-posted the credit
    //    note on retry. Now a crash before the stamp leaves at most an orphan
    //    DRAFT (no GL), and after it the resume pass above confirms the claim.
    const moneyRet = await createSalesReturnAction({ salesInvoiceId: inv.id, date, lines: [{ itemId, quantity: qty, unitPrice }] });
    if (!moneyRet.ok || !moneyRet.id) { flag(rf.orderId, moneyRet.error || "تعذّر مرتجع الفاتورة"); continue; }
    await db.update(marketplaceSettlementTxns).set({ salesReturnId: moneyRet.id }).where(eq(marketplaceSettlementTxns.id, rf.id));
    const confMoney = await confirmSalesReturnAction(moneyRet.id);
    if (!confMoney.ok) { flag(rf.orderId, confMoney.error || "تعذّر ترحيل مرتجع الفاتورة"); continue; }

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

    // Already stamped (claim-first) before the confirm above.
    created++;
  }
  return { created, unmatched };
}

/**
 * Idempotent upsert of settlement rows (no GL). On dedupKey conflict, only
 * status/releaseDate/salesOrderId refresh. Returns how many rows were new.
 */
export async function upsertSettlementTxns(orgId: string, txns: SettlementTxn[], channel = "AMAZON"): Promise<{ imported: number; updated: number }> {
  if (txns.length === 0) return { imported: 0, updated: 0 };
  const orderMap = await linkOrders(orgId, txns, channel);
  const values = txns.map((t) => ({
    organizationId: orgId, channel, settlementId: t.settlementId || null, type: t.type,
    orderId: t.orderId || null, sku: t.sku || null, description: t.description || null,
    quantity: String(t.quantity), postedAt: t.postedAt, status: t.status, releaseDate: t.releaseDate, currency: t.currency ?? null,
    productSales: String(t.productSales), shippingCredits: String(t.shippingCredits), promotionalRebates: String(t.promotionalRebates),
    sellingFees: String(t.sellingFees), fbaFees: String(t.fbaFees), otherTransactionFees: String(t.otherTransactionFees),
    other: String(t.other), total: String(t.total), dedupKey: settlementDedupKey(t),
    salesOrderId: (t.orderId && orderMap.get(t.orderId)) || null,
  }));

  const beforeCount = (await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.channel, channel))))[0]?.n ?? 0;

  // Two flat-file groups can share a dedupKey (it omits shipmentId): merge them
  // before insert, else ON CONFLICT hits Postgres' "cannot affect row a second
  // time" and the whole sync fails on every re-pull. Summing keeps totals intact.
  const byKey = new Map<string, (typeof values)[number]>();
  for (const v of values) {
    const prev = byKey.get(v.dedupKey);
    if (!prev) { byKey.set(v.dedupKey, v); continue; }
    for (const k of ["quantity", "productSales", "shippingCredits", "promotionalRebates", "sellingFees", "fbaFees", "otherTransactionFees", "other", "total"] as const) {
      prev[k] = String(r2(Number(prev[k]) + Number(v[k])));
    }
  }
  const merged = [...byKey.values()];

  for (let i = 0; i < merged.length; i += 500) {
    await db.insert(marketplaceSettlementTxns).values(merged.slice(i, i + 500)).onConflictDoUpdate({
      target: [marketplaceSettlementTxns.organizationId, marketplaceSettlementTxns.dedupKey],
      set: {
        status: sql`excluded.status`,
        releaseDate: sql`excluded.release_date`,
        salesOrderId: sql`coalesce(excluded.sales_order_id, ${marketplaceSettlementTxns.salesOrderId})`,
      },
    });
  }
  const afterCount = (await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.channel, channel))))[0]?.n ?? 0;
  const imported = Number(afterCount) - Number(beforeCount);
  return { imported, updated: txns.length - imported };
}

export type PostSettlementsResult = {
  posted: number;           // settlement rows GL-posted
  perOrderEntries: number;  // number of per-order journal entries created
  heldForImport: number;    // Order rows NOT posted — no imported order or no live invoice
  historicalSkipped?: number; // rows dated before the go-live accounting start date (never posted)
  deferredHeld: number; returnsCreated: number; returnsUnmatched: string[];
};

const numAmounts = (r: { type: string; productSales: string; shippingCredits: string; promotionalRebates: string; sellingFees: string; fbaFees: string; otherTransactionFees: string; other: string; total: string }): SettleAmounts => ({
  type: r.type,
  productSales: Number(r.productSales), shippingCredits: Number(r.shippingCredits), promotionalRebates: Number(r.promotionalRebates),
  sellingFees: Number(r.sellingFees), fbaFees: Number(r.fbaFees), otherTransactionFees: Number(r.otherTransactionFees),
  other: Number(r.other), total: Number(r.total),
});
const rowKey = (ids: string[]) => createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 40);
const maxDate = (rows: { releaseDate: Date | null }[]): Date =>
  rows.reduce<Date | null>((mx, r) => { const d = r.releaseDate ? new Date(r.releaseDate) : null; return d && (!mx || d > mx) ? d : mx; }, null) ?? new Date();

/**
 * Post released, not-yet-posted settlement rows: ONE journal entry PER matched order
 * (collecting that order's Amazon receivable against its live invoice — traceable so
 * a later refund stays attributable), plus ONE aggregated entry for non-order rows
 * (ads / service fees / FBA-inventory / SAFE-T / bank transfers). Order rows whose
 * sales order was never imported (or has no live invoice) are HELD — never touching
 * AR — until the order exists. Then runs the refund cycle. Idempotent (posted rows
 * carry journal_entry_id, so a re-run skips them).
 */
export async function postSettlements(orgId: string, userId?: string | null, channel = "AMAZON"): Promise<PostSettlementsResult | { error: string }> {
  const cfg = channelCfg(channel);
  const accs = await ensureAmazonAccounts(orgId);
  if ("error" in accs) return { error: accs.error };

  // The platform's wallet GL is the settlement INTERMEDIATE: per-order collections
  // Dr it, the bank transfer Cr's it, so its balance = funds the marketplace holds
  // unremitted (≈ its "available balance"). `accs.bank` stays the real bank (1102) —
  // the transfer's destination. Per-channel wallet: 1109 Amazon / 1110 Shopify.
  const plat = await ensurePlatform(orgId, channel);
  accs.clearing = await ensurePlatformWalletGl(orgId, cfg.walletCode, cfg.walletName);
  // Repoint the wallet bank to the wallet GL if it still points at the general bank GL
  // (legacy Amazon wallet shared 1102). Never overrides a GL the user deliberately set.
  if (plat?.bankAccountId) {
    await db.update(bankAccounts).set({ glAccountId: accs.clearing })
      .where(and(eq(bankAccounts.id, plat.bankAccountId), eq(bankAccounts.organizationId, orgId), eq(bankAccounts.glAccountId, accs.bank)));
  }

  // Go-Live cutoff: settlement txns dated BEFORE the platform's accounting start
  // date are historical (their money is covered by the wallet's opening balance),
  // so they're imported but never posted — otherwise a first post-go-live transfer
  // paying pre-go-live orders would drain the wallet with nothing collected.
  const [platRow] = await db.select({ startDate: salesPlatforms.accountingStartDate }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, channel))).limit(1);
  const startDate = platRow?.startDate ?? null;

  const toPostConds = [
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.channel, channel),
    eq(marketplaceSettlementTxns.status, "Released"),
    isNull(marketplaceSettlementTxns.journalEntryId),
  ];
  if (startDate) toPostConds.push(sql`${marketplaceSettlementTxns.releaseDate} >= ${startDate}`);

  const toPost = await db.select({
    id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type,
    productSales: marketplaceSettlementTxns.productSales, shippingCredits: marketplaceSettlementTxns.shippingCredits,
    promotionalRebates: marketplaceSettlementTxns.promotionalRebates, sellingFees: marketplaceSettlementTxns.sellingFees,
    fbaFees: marketplaceSettlementTxns.fbaFees, otherTransactionFees: marketplaceSettlementTxns.otherTransactionFees,
    other: marketplaceSettlementTxns.other, total: marketplaceSettlementTxns.total, releaseDate: marketplaceSettlementTxns.releaseDate,
    salesOrderId: marketplaceSettlementTxns.salesOrderId,
  }).from(marketplaceSettlementTxns).where(and(...toPostConds));

  const historicalSkipped = startDate
    ? Number((await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns).where(and(
        eq(marketplaceSettlementTxns.organizationId, orgId),
        eq(marketplaceSettlementTxns.channel, channel),
        eq(marketplaceSettlementTxns.status, "Released"),
        isNull(marketplaceSettlementTxns.journalEntryId),
        sql`${marketplaceSettlementTxns.releaseDate} < ${startDate}`,
      )))[0]?.n ?? 0)
    : 0;

  const deferredHeld = Number((await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(and(
      eq(marketplaceSettlementTxns.organizationId, orgId),
      eq(marketplaceSettlementTxns.channel, channel),
      isNull(marketplaceSettlementTxns.journalEntryId),
      sql`${marketplaceSettlementTxns.status} <> 'Released'`,
    )))[0]?.n ?? 0);

  const { orderGroups, heldOrderRows, nonOrderRows } = splitSettlementRows(toPost);

  // Which order groups have a LIVE invoice (via delivery → invoice)? Only those get
  // a per-order collection; the rest are held (their AR was never booked).
  const orderIds = [...orderGroups.keys()];
  const invoiceRows = orderIds.length
    ? await db.select({
        invoiceId: salesInvoices.id, invoiceNumber: salesInvoices.number,
        customerId: salesInvoices.customerId, orderId: deliveryNotes.salesOrderId,
      })
      .from(salesInvoices)
      .innerJoin(deliveryNotes, eq(deliveryNotes.id, salesInvoices.deliveryNoteId))
      .where(and(
        eq(salesInvoices.organizationId, orgId),
        liveInvoice(salesInvoices.status),
        inArray(deliveryNotes.salesOrderId, orderIds),
      ))
    : [];
  const invByOrder = new Map(invoiceRows.filter((r) => r.orderId).map((r) => [r.orderId!, r]));
  const postableOrderIds = orderIds.filter((oid) => invByOrder.has(oid));
  const heldForImport = heldOrderRows.length +
    orderIds.filter((oid) => !invByOrder.has(oid)).reduce((s, oid) => s + orderGroups.get(oid)!.length, 0);

  const line = (accountId: string, amount: number, description: string) =>
    ({ accountId, debit: amount >= 0 ? amount : 0, credit: amount < 0 ? -amount : 0, description });

  const nonOrderPostable = nonOrderRows.length > 0 && (() => {
    const gl = nonOrderGL(nonOrderRows.map(numAmounts));
    return gl.fees !== 0 || gl.bank !== 0 || gl.clearing !== 0;
  })();

  let perOrderEntries = 0;
  if (postableOrderIds.length === 0 && !nonOrderPostable) {
    const ret0 = await processSettlementRefunds(orgId, channel);
    return { posted: 0, perOrderEntries: 0, heldForImport, historicalSkipped, deferredHeld, returnsCreated: ret0.created, returnsUnmatched: ret0.unmatched };
  }

  // Rows that will actually be GL-posted this run (per-order groups + non-order).
  const postableRowIds = [
    ...postableOrderIds.flatMap((oid) => orderGroups.get(oid)!.map((r) => r.id)),
    ...(nonOrderPostable ? nonOrderRows.map((r) => r.id) : []),
  ];

  try {
    await db.transaction(async (tx) => {
      // Re-verify under lock that every postable row is STILL unposted (concurrent
      // auto-post + manual post race — the unique index alone wouldn't catch it).
      const idList = sql.join(postableRowIds.map((id) => sql`${id}`), sql`, `);
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT id FROM marketplace_settlement_txns
        WHERE organization_id = ${orgId} AND id IN (${idList}) AND journal_entry_id IS NULL
        FOR UPDATE`);
      if (locked.rows.length !== postableRowIds.length) throw new Error("تغيّرت التسويات أثناء الترحيل (ترحيل متزامن) — أعد المحاولة");

      // ── one entry per matched order (collects its receivable against its invoice) ──
      for (const oid of postableOrderIds) {
        const grp = orderGroups.get(oid)!;
        const gl = perOrderGL(grp.map(numAmounts));
        const inv = invByOrder.get(oid)!;
        const lines = [
          line(accs.clearing, gl.clearing, `رصيد ${cfg.label} — فاتورة ${inv.invoiceNumber}`),
          line(accs.fees, gl.fees, `رسوم ${cfg.label} — فاتورة ${inv.invoiceNumber}`),
          line(accs.receivable, -gl.receivable, `تحصيل ذمم — فاتورة ${inv.invoiceNumber}`),
        ].filter((l) => l.debit !== 0 || l.credit !== 0);
        if (lines.length === 0) continue;
        const jid = await postEntry(tx, {
          orgId, date: maxDate(grp), sourceType: cfg.sourceType,
          sourceId: `${cfg.srcPrefix}-O-${rowKey(grp.map((r) => r.id))}`,
          description: `تسوية ${cfg.label} — تحصيل فاتورة ${inv.invoiceNumber}`,
          userId, lines,
        });
        perOrderEntries++;
        const amt = r2(gl.receivable);
        if (amt !== 0) {
          await tx.update(salesInvoices).set({
            balanceDue: sql`${salesInvoices.balanceDue} - ${amt}`,
            paidAmount: sql`${salesInvoices.paidAmount} + ${amt}`,
            status: sql`CASE WHEN ${salesInvoices.balanceDue} - ${amt} <= 0.01 THEN 'PAID' ELSE 'PARTIAL_PAID' END`,
          }).where(eq(salesInvoices.id, inv.invoiceId));
          await tx.update(customers).set({ balance: sql`${customers.balance} - ${amt}` })
            .where(eq(customers.id, inv.customerId));
        }
        await tx.update(marketplaceSettlementTxns).set({ journalEntryId: jid })
          .where(inArray(marketplaceSettlementTxns.id, grp.map((r) => r.id)));
      }

      // ── one aggregated entry for non-order rows (ads / fees / transfers) ──
      if (nonOrderPostable) {
        const gl = nonOrderGL(nonOrderRows.map(numAmounts));
        const lines = [
          line(accs.clearing, gl.clearing, `صافي رصيد ${cfg.label} (بنود غير مرتبطة بطلب)`),
          line(accs.fees, gl.fees, `رسوم ومصاريف ${cfg.label}`),
          line(accs.bank, gl.bank, `تحويلات ${cfg.label} إلى البنك`),
        ].filter((l) => l.debit !== 0 || l.credit !== 0);
        if (lines.length > 0) {
          const jid = await postEntry(tx, {
            orgId, date: maxDate(nonOrderRows), sourceType: cfg.sourceType,
            sourceId: `${cfg.srcPrefix}-AGG-${rowKey(nonOrderRows.map((r) => r.id))}`,
            description: `تسوية ${cfg.label} — رسوم ومصاريف مجمّعة (${nonOrderRows.length} بند)`,
            userId, lines,
          });
          await tx.update(marketplaceSettlementTxns).set({ journalEntryId: jid })
            .where(inArray(marketplaceSettlementTxns.id, nonOrderRows.map((r) => r.id)));
        }
      }
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر ترحيل قيد التسوية" };
  }

  const ret = await processSettlementRefunds(orgId, channel);
  await bust(orgKey(orgId, "platform-pnl")); // posting changed platform profitability → drop its cached report
  return { posted: postableRowIds.length, perOrderEntries, heldForImport, historicalSkipped, deferredHeld, returnsCreated: ret.created, returnsUnmatched: ret.unmatched };
}

/**
 * Un-post every posted Amazon settlement entry: DELETE each GL entry (+ lines),
 * restore the customer subledger it moved (invoice balanceDue/paidAmount/status +
 * customers.balance), and null the txns' journal_entry_id so they become re-postable.
 * The supported correction path — un-post, then Post again to rebuild with current
 * (per-order) logic. Idempotent (only touches still-POSTED settlement entries).
 *
 * Deletes rather than mirror-reverses on purpose: the balance queries
 * (lib/erp/financials.ts) aggregate status='POSTED' ONLY, so a mirror-reversal
 * (original→REVERSED + a POSTED mirror) would double-apply. A settlement entry is a
 * system-generated aggregate, not a hand-entered document, so removing it is the
 * clean un-post. `userId` kept for signature parity / future audit.
 */
export async function reverseSettlementPosting(orgId: string, userId?: string | null, channel = "AMAZON", settlementId?: string | null): Promise<{ reversed: number } | { error: string }> {
  void userId;
  const cfg = channelCfg(channel);
  // Scope to a single settlement when asked (reverse one fortnight, not the whole history):
  // its posted journal entries are those linked from its txns. Otherwise all channel entries.
  const posted = settlementId
    ? (await db.selectDistinct({ jid: marketplaceSettlementTxns.journalEntryId })
        .from(marketplaceSettlementTxns)
        .where(and(
          eq(marketplaceSettlementTxns.organizationId, orgId),
          eq(marketplaceSettlementTxns.channel, channel),
          eq(marketplaceSettlementTxns.settlementId, settlementId),
          isNotNull(marketplaceSettlementTxns.journalEntryId),
        ))).map((r) => ({ jid: r.jid! }))
    : await db.select({ jid: journalEntries.id })
        .from(journalEntries)
        .where(and(
          eq(journalEntries.organizationId, orgId),
          eq(journalEntries.sourceType, cfg.sourceType),
          eq(journalEntries.status, "POSTED"),
        ));
  if (posted.length === 0) return { reversed: 0 };

  let reversed = 0;
  try {
    for (const { jid } of posted) {
      const txns = await db.select({
        id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type, salesOrderId: marketplaceSettlementTxns.salesOrderId,
        productSales: marketplaceSettlementTxns.productSales, shippingCredits: marketplaceSettlementTxns.shippingCredits,
        promotionalRebates: marketplaceSettlementTxns.promotionalRebates, other: marketplaceSettlementTxns.other,
      }).from(marketplaceSettlementTxns).where(and(
        eq(marketplaceSettlementTxns.organizationId, orgId),
        eq(marketplaceSettlementTxns.journalEntryId, jid),
      ));

      // Which per-order receivable did this entry apply to the subledger? (Order/Refund
      // with a live invoice — mirrors what post moved, so reversal restores exactly.)
      const arByOrder = new Map<string, number>();
      for (const t of txns) {
        if ((t.type !== "Order" && t.type !== "Refund") || !t.salesOrderId) continue;
        const amt = Number(t.productSales) + Number(t.shippingCredits) + Number(t.promotionalRebates) + Number(t.other);
        arByOrder.set(t.salesOrderId, (arByOrder.get(t.salesOrderId) ?? 0) + amt);
      }
      const orderIds = [...arByOrder.keys()];
      const invoiceRows = orderIds.length
        ? await db.select({ invoiceId: salesInvoices.id, customerId: salesInvoices.customerId, orderId: deliveryNotes.salesOrderId })
            .from(salesInvoices)
            .innerJoin(deliveryNotes, eq(deliveryNotes.id, salesInvoices.deliveryNoteId))
            .where(and(eq(salesInvoices.organizationId, orgId), inArray(deliveryNotes.salesOrderId, orderIds)))
        : [];
      const invByOrder = new Map(invoiceRows.filter((r) => r.orderId).map((r) => [r.orderId!, r]));

      await db.transaction(async (tx) => {
        // Detach the txns first (FK), then delete the entry's lines + the entry.
        await tx.update(marketplaceSettlementTxns).set({ journalEntryId: null })
          .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.journalEntryId, jid)));
        await tx.delete(journalEntryLines).where(eq(journalEntryLines.journalEntryId, jid));
        await tx.delete(journalEntries).where(and(eq(journalEntries.id, jid), eq(journalEntries.organizationId, orgId)));
        for (const [oid, amount] of arByOrder) {
          const inv = invByOrder.get(oid);
          if (!inv) continue;
          const amt = r2(amount);
          if (amt === 0) continue;
          await tx.update(salesInvoices).set({
            balanceDue: sql`${salesInvoices.balanceDue} + ${amt}`,
            paidAmount: sql`${salesInvoices.paidAmount} - ${amt}`,
            status: sql`CASE WHEN ${salesInvoices.paidAmount} - ${amt} <= 0.01 THEN 'POSTED' WHEN ${salesInvoices.balanceDue} + ${amt} <= 0.01 THEN 'PAID' ELSE 'PARTIAL_PAID' END`,
          }).where(eq(salesInvoices.id, inv.invoiceId));
          await tx.update(customers).set({ balance: sql`${customers.balance} + ${amt}` })
            .where(eq(customers.id, inv.customerId));
        }
      });
      reversed++;
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر عكس ترحيل التسوية" };
  }
  if (reversed > 0) await bust(orgKey(orgId, "platform-pnl")); // un-posting changed profitability too
  return { reversed };
}
