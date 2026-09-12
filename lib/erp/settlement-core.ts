import "server-only";
import { createHash } from "crypto";
import { round2 as r2 } from "@/lib/erp/money";
import { and, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts, salesOrders, marketplaceSettlementTxns, deliveryNotes, salesInvoices,
  salesInvoiceLines, itemCodes, items, bankAccounts, customers, salesReturns, journalEntries, journalEntryLines, salesPlatforms,
} from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { postEntry } from "@/lib/erp/posting";
import { createSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { ensurePlatform, ensurePlatformWalletGl } from "@/lib/erp/platform-provision";
import { settlementDedupKey, type SettlementTxn } from "@/lib/erp/amazon-settlement";
import { marketplaceTxnItems } from "@/db/schema";
import { splitSettlementRows, perOrderGL, nonOrderGL, perOrderFeesByCat, nonOrderFeesByCat, type SettleAmounts } from "@/lib/erp/settlement-gl";
import { FEE_CATEGORY_ACCOUNT, FEE_CATEGORY_LABEL, type FeeCatKey } from "@/lib/erp/settlement-fees";
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
  // Noon has NO settlement API — its rows come from the manual "record transfer" entry
  // (recordNoonTransferAction). Same double-entry, own wallet GL (1111 محفظة نون), so
  // channelCfg("NOON") must NOT fall through to Amazon (wrong wallet/label/sourceType).
  NOON: { label: "نون", walletCode: "1111", walletName: "محفظة نون", sourceType: "NOON_SETTLEMENT", srcPrefix: "NOON" },
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

/** Get-or-create the Amazon clearing (asset) + Amazon fees (expense) accounts + the
 *  per-category fee sub-accounts. Resolves the org's configured accounts via the override
 *  layer; only creates the default-coded ones when neither an override nor an existing
 *  account is found. `feeAcc` maps each routed fee category → its GL account. */
async function ensureAmazonAccounts(orgId: string): Promise<{ clearing: string; fees: string; receivable: string; bank: string; feeAcc: Partial<Record<FeeCatKey, string>> } | { error: string }> {
  const feeDefs = Object.entries(FEE_CATEGORY_ACCOUNT) as [FeeCatKey, { code: string; nameAr: string }][];
  const ov = await resolveAccountIds(orgId, ["1103", "1102", "1108", "5203", "5", "11", ...feeDefs.map(([, d]) => d.code)]);
  const receivable = ov["1103"];
  const bank = ov["1102"];
  if (!receivable || !bank) return { error: "أنشئ دليل الحسابات القياسي أولاً (حسابات الذمم/البنك غير موجودة)" };
  const parent5 = ov["5"] ?? null;
  const parent11 = ov["11"] ?? null;

  let clearing = ov["1108"];
  let fees = ov["5203"];
  if (!clearing) {
    const [r] = await db.insert(accounts).values({
      organizationId: orgId, code: "1108", nameAr: "رصيد أمازون الوسيط", type: "ASSET", normalBalance: "DEBIT", parentId: parent11, isLeaf: true,
    }).returning({ id: accounts.id });
    clearing = r.id;
  }
  if (!fees) {
    const [r] = await db.insert(accounts).values({
      organizationId: orgId, code: "5203", nameAr: "رسوم أمازون", type: "EXPENSE", normalBalance: "DEBIT", parentId: parent5, isLeaf: true,
    }).returning({ id: accounts.id });
    fees = r.id;
  }
  // Per-category fee sub-accounts (advertising/FBA/referral/…), created on demand so the
  // P&L splits fees instead of lumping them on 5203. Reimbursement/other stay on 5203.
  const feeAcc: Partial<Record<FeeCatKey, string>> = {};
  for (const [key, def] of feeDefs) {
    let id = ov[def.code];
    if (!id) {
      const [r] = await db.insert(accounts).values({
        organizationId: orgId, code: def.code, nameAr: def.nameAr, type: "EXPENSE", normalBalance: "DEBIT", parentId: parent5, isLeaf: true,
      }).returning({ id: accounts.id });
      id = r.id;
    }
    feeAcc[key] = id;
  }
  return { clearing, fees, receivable, bank, feeAcc };
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
 * For every not-yet-processed "Refund" settlement row, raise a DRAFT مرتجع فاتورة
 * against the original order's posted invoice — and stop there.
 *
 * It used to confirm the credit note and restock off the delivery in the same pass. That
 * assumes the goods are back, and a marketplace refund does not mean that: the customer
 * returns to Amazon, which may never ship the unit on, may ship it damaged, or may refund
 * without a return at all. So the money side waits as a DRAFT in the returns register and
 * the trader completes it with a RECEIPT decision — received sellable, received damaged,
 * or not received (awaiting a reimbursement) — through confirmPlatformReturnAction. That
 * gate already existed; the refund path simply bypassed it.
 *
 * Deferred refunds count too. Amazon holding the money changes when it is paid, not
 * whether the customer was refunded, and a DRAFT posts nothing either way.
 *
 * Idempotent: a Refund row is skipped once its `salesReturnId` is set.
 */
export async function processSettlementRefunds(orgId: string, channel: string): Promise<{ created: number; unmatched: string[] }> {
  const refunds = await db.select({
    id: marketplaceSettlementTxns.id, orderId: marketplaceSettlementTxns.orderId,
    sku: marketplaceSettlementTxns.sku, quantity: marketplaceSettlementTxns.quantity,
    releaseDate: marketplaceSettlementTxns.releaseDate, postedAt: marketplaceSettlementTxns.postedAt,
  }).from(marketplaceSettlementTxns).where(and(
    eq(marketplaceSettlementTxns.organizationId, orgId),
    eq(marketplaceSettlementTxns.channel, channel),
    eq(marketplaceSettlementTxns.type, "Refund"),
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

    // The DRAFT credit note, carrying its channel so it lands in the marketplace returns
    // register. Stamped immediately so a crash can't produce a second one on retry. It is
    // NOT confirmed and nothing is restocked: that waits on the receipt decision.
    const moneyRet = await createSalesReturnAction({
      salesInvoiceId: inv.id, date,
      notes: `مرتجع ${channel} — طلب ${rf.orderId}`,
      channel, externalReturnId: rf.orderId,
      lines: [{ itemId, quantity: qty, unitPrice }],
    });
    if (!moneyRet.ok || !moneyRet.id) { flag(rf.orderId, moneyRet.error || "تعذّر إنشاء مرتجع الفاتورة"); continue; }
    await db.update(marketplaceSettlementTxns).set({ salesReturnId: moneyRet.id }).where(eq(marketplaceSettlementTxns.id, rf.id));

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
    transactionId: t.transactionId ?? null, shipmentId: t.shipmentId ?? null,
    breakdown: (t.breakdown ?? null) as never,
  }));
  // Rows whose key came from the source (listTransactions, anchored on the shipment)
  // must never be summed on collision — see the merge below.
  const itemsByKey = new Map<string, NonNullable<SettlementTxn["items"]>>();
  const sourceKeyed = new Set<string>();
  for (const t of txns) {
    if (!t.dedupKey) continue;
    sourceKeyed.add(t.dedupKey);
    if (t.items?.length) itemsByKey.set(t.dedupKey, t.items);
  }

  const beforeCount = (await db.select({ n: sql<number>`count(*)` }).from(marketplaceSettlementTxns)
    .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), eq(marketplaceSettlementTxns.channel, channel))))[0]?.n ?? 0;

  // Two flat-file groups can share a dedupKey (it omits shipmentId): merge them
  // before insert, else ON CONFLICT hits Postgres' "cannot affect row a second
  // time" and the whole sync fails on every re-pull. Summing keeps totals intact.
  const byKey = new Map<string, (typeof values)[number]>();
  for (const v of values) {
    const prev = byKey.get(v.dedupKey);
    if (!prev) { byKey.set(v.dedupKey, v); continue; }
    if (sourceKeyed.has(v.dedupKey)) {
      // ONE economic event, reported again at a later stage of its life. A single pull
      // routinely contains a shipment as DEFERRED_RELEASED and again as RELEASED — the
      // same 1,841.31, not 3,682.62 — so the later view REPLACES the earlier one.
      // Released outranks Deferred; between equals, the later posting date wins.
      const better = (v.status === "Released" && prev.status !== "Released")
        || (v.status === prev.status && (v.postedAt?.getTime() ?? 0) > (prev.postedAt?.getTime() ?? 0));
      if (better) byKey.set(v.dedupKey, v);
      continue;
    }
    // Flat-file rows: two groups can share a key because it omits the shipment id, and
    // there they really are two amounts that belong together.
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
        releaseDate: sql`coalesce(excluded.release_date, ${marketplaceSettlementTxns.releaseDate})`,
        salesOrderId: sql`coalesce(excluded.sales_order_id, ${marketplaceSettlementTxns.salesOrderId})`,
        // A re-pull carries the authoritative amounts — Amazon can revise a transaction
        // between statuses, and the stored row should follow rather than keep the first
        // figure it ever saw.
        postedAt: sql`coalesce(excluded.posted_at, ${marketplaceSettlementTxns.postedAt})`,
        transactionId: sql`coalesce(excluded.transaction_id, ${marketplaceSettlementTxns.transactionId})`,
        shipmentId: sql`coalesce(excluded.shipment_id, ${marketplaceSettlementTxns.shipmentId})`,
        breakdown: sql`coalesce(excluded.breakdown, ${marketplaceSettlementTxns.breakdown})`,
        productSales: sql`excluded.product_sales`,
        promotionalRebates: sql`excluded.promotional_rebates`,
        sellingFees: sql`excluded.selling_fees`,
        fbaFees: sql`excluded.fba_fees`,
        otherTransactionFees: sql`excluded.other_transaction_fees`,
        other: sql`excluded.other`,
        total: sql`excluded.total`,
      },
    });
  }

  // Per-SKU children. Written after the parents so the ids exist; replaced wholesale for
  // each transaction, because a re-pull is the authority on what the transaction contains.
  if (itemsByKey.size) {
    const keys = [...itemsByKey.keys()];
    const parents = await db.select({ id: marketplaceSettlementTxns.id, dedupKey: marketplaceSettlementTxns.dedupKey })
      .from(marketplaceSettlementTxns)
      .where(and(eq(marketplaceSettlementTxns.organizationId, orgId), inArray(marketplaceSettlementTxns.dedupKey, keys)));
    const idByKey = new Map(parents.map((p) => [p.dedupKey, p.id]));
    const ids = [...idByKey.values()];
    if (ids.length) {
      await db.delete(marketplaceTxnItems)
        .where(and(eq(marketplaceTxnItems.organizationId, orgId), inArray(marketplaceTxnItems.txnId, ids)));
      const rows = keys.flatMap((k) => {
        const txnId = idByKey.get(k);
        if (!txnId) return [];
        return (itemsByKey.get(k) ?? []).map((i) => ({
          organizationId: orgId, txnId,
          sku: i.sku, asin: i.asin, quantity: String(i.quantity),
          productCharges: String(i.productCharges),
          commission: String(i.commission), commissionTax: String(i.commissionTax),
          fbaFee: String(i.fbaFee), fbaFeeTax: String(i.fbaFeeTax),
          otherFees: String(i.otherFees), total: String(i.total),
          breakdown: (i.breakdown ?? null) as never,
        }));
      });
      for (let i = 0; i < rows.length; i += 500) await db.insert(marketplaceTxnItems).values(rows.slice(i, i + 500));
    }
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
    id: marketplaceSettlementTxns.id, type: marketplaceSettlementTxns.type, description: marketplaceSettlementTxns.description,
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

  // Split the total fee across per-category GL sub-accounts, with a residual line on the
  // base fees account (5203) absorbing rounding + reimbursement/other so Σ == totalFees
  // exactly (the balance trigger rejects any 0.01 drift). Same shape whether the categories
  // come from an order's fee buckets or the non-order rows.
  const routedCats = Object.keys(FEE_CATEGORY_ACCOUNT) as FeeCatKey[];
  const feeLines = (totalFees: number, byCat: Partial<Record<FeeCatKey, number>>, label: string) => {
    const out: ReturnType<typeof line>[] = [];
    let residual = r2(totalFees);
    for (const k of routedCats) {
      const amt = r2(byCat[k] ?? 0);
      const acc = accs.feeAcc[k];
      if (amt !== 0 && acc) { out.push(line(acc, amt, `${FEE_CATEGORY_LABEL[k]} — ${label}`)); residual = r2(residual - amt); }
    }
    if (residual !== 0) out.push(line(accs.fees, residual, `رسوم ${label}`));
    return out;
  };

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
          ...feeLines(gl.fees, perOrderFeesByCat(grp.map(numAmounts)), `${cfg.label} — فاتورة ${inv.invoiceNumber}`),
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
        const byCat = nonOrderFeesByCat(nonOrderRows.map((r) => ({ type: r.type, description: r.description, total: Number(r.total) })));
        const lines = [
          line(accs.clearing, gl.clearing, `صافي رصيد ${cfg.label} (بنود غير مرتبطة بطلب)`),
          ...feeLines(gl.fees, byCat, `${cfg.label}`),
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
