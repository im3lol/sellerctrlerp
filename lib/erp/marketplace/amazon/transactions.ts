import "server-only";
import { spJson, paced, credKey } from "./client";
import { round2 } from "@/lib/erp/money";
import type { Credential } from "../connector";

/**
 * Finances 2024-06-19 `listTransactions` — every transaction, deferred or settled.
 *
 * The connector used to learn about money only from the settlement flat file, which
 * carries what Amazon has already RELEASED. Under the delivery-date policy a shipment sits
 * DEFERRED for a week or more, so recent orders had no fees recorded at all: 32
 * transactions existed for the last 30 days and 16 rows in total had ever been stored.
 * That is why the reports showed Amazon fees that were far too small.
 *
 * Amazon reports the same economic event up to three times as it matures:
 *
 *     DEFERRED  →  DEFERRED_RELEASED  →  RELEASED
 *
 * with a DIFFERENT `transactionId` each time (and a different settlement id and financial
 * event group). Keying on any of those would count one order's fees twice or three times.
 * `SHIPMENT_ID` is the one identifier that stays the same across all three, so it anchors
 * the dedup key and a later status simply updates the row it already wrote.
 */

type Money = { currencyAmount?: number; currencyCode?: string };
type Breakdown = { breakdownType?: string; breakdownAmount?: Money; breakdowns?: Breakdown[] };
type RelatedId = { relatedIdentifierName?: string; relatedIdentifierValue?: string };
type ItemContext = { contextType?: string; sku?: string; asin?: string; quantityShipped?: number };
type TxnItem = { description?: string; totalAmount?: Money; breakdowns?: Breakdown[]; contexts?: ItemContext[] };

export type ApiTransaction = {
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  postedDate?: string;
  description?: string;
  totalAmount?: Money;
  relatedIdentifiers?: RelatedId[];
  items?: TxnItem[];
  breakdowns?: Breakdown[];
};

export type TxnItemRow = {
  sku: string | null; asin: string | null; quantity: number;
  productCharges: number; commission: number; commissionTax: number;
  fbaFee: number; fbaFeeTax: number; otherFees: number; total: number;
  breakdown: unknown;
};

export type TxnRow = {
  transactionId: string | null; shipmentId: string | null; settlementId: string | null;
  orderId: string | null; type: string; status: "Deferred" | "Released";
  postedAt: Date | null; description: string | null; currency: string | null;
  productSales: number; promotionalRebates: number;
  sellingFees: number; fbaFees: number; otherTransactionFees: number; other: number;
  total: number; dedupKey: string; breakdown: unknown;
  sku: string | null; quantity: number;
  items: TxnItemRow[];
};

const amt = (m?: Money) => Number(m?.currencyAmount ?? 0) || 0;
const idOf = (ids: RelatedId[] | undefined, name: string) =>
  ids?.find((r) => r.relatedIdentifierName === name)?.relatedIdentifierValue ?? null;

/** Depth-first search for a breakdown node by type, at any level. */
function findBreakdown(list: Breakdown[] | undefined, type: string): Breakdown | undefined {
  for (const b of list ?? []) {
    if (b.breakdownType === type) return b;
    const deeper = findBreakdown(b.breakdowns, type);
    if (deeper) return deeper;
  }
  return undefined;
}
const sumOf = (list: Breakdown[] | undefined, type: string) => amt(findBreakdown(list, type)?.breakdownAmount);
/** A fee's tax half, e.g. Commission → Tax. Amazon nests Base and Tax under each fee. */
const taxOf = (list: Breakdown[] | undefined, type: string) =>
  amt(findBreakdown(findBreakdown(list, type)?.breakdowns, "Tax")?.breakdownAmount);

/**
 * A DEFERRED_RELEASED row is the same money as the RELEASED one that follows it, not extra
 * money — both mean "no longer held". Only DEFERRED is still pending.
 */
const statusOf = (s?: string): "Deferred" | "Released" => (s === "DEFERRED" ? "Deferred" : "Released");

/**
 * The existing table (and everything reading it) speaks the settlement report's vocabulary,
 * where a sale is an "Order". listTransactions calls it a Shipment.
 */
const typeOf = (t?: string) => (t === "Shipment" ? "Order" : t ?? "other-transaction");

/** Pure: one API transaction → the row to store, with its per-SKU children. */
export function toTxnRow(t: ApiTransaction): TxnRow {
  const orderId = idOf(t.relatedIdentifiers, "ORDER_ID");
  const shipmentId = idOf(t.relatedIdentifiers, "SHIPMENT_ID");
  const type = typeOf(t.transactionType);
  const total = round2(amt(t.totalAmount));

  const items: TxnItemRow[] = (t.items ?? []).map((it) => {
    const ctx = it.contexts?.find((c) => c.contextType === "ProductContext");
    const commission = round2(sumOf(it.breakdowns, "Commission"));
    const fbaFee = round2(sumOf(it.breakdowns, "FBAPerUnitFulfillmentFee"));
    const allFees = round2(sumOf(it.breakdowns, "AmazonFees"));
    return {
      sku: ctx?.sku ?? null,
      asin: ctx?.asin ?? null,
      quantity: Number(ctx?.quantityShipped ?? 0) || 0,
      productCharges: round2(sumOf(it.breakdowns, "ProductCharges")),
      commission,
      commissionTax: round2(taxOf(it.breakdowns, "Commission")),
      fbaFee,
      fbaFeeTax: round2(taxOf(it.breakdowns, "FBAPerUnitFulfillmentFee")),
      // Whatever AmazonFees holds beyond the two named ones, so a new fee type Amazon
      // introduces is still captured instead of silently vanishing from the total.
      otherFees: round2(allFees - commission - fbaFee),
      total: round2(amt(it.totalAmount)),
      breakdown: it.breakdowns ?? null,
    };
  });

  const sum = (pick: (i: TxnItemRow) => number) => round2(items.reduce((s, i) => s + pick(i), 0));

  return {
    transactionId: t.transactionId ?? null,
    shipmentId, settlementId: idOf(t.relatedIdentifiers, "SETTLEMENT_ID"), orderId,
    type, status: statusOf(t.transactionStatus),
    postedAt: t.postedDate ? new Date(t.postedDate) : null,
    description: t.description ?? null,
    currency: t.totalAmount?.currencyCode ?? null,
    productSales: sum((i) => i.productCharges),
    promotionalRebates: round2(sumOf(t.breakdowns, "PromoRebates")),
    sellingFees: sum((i) => i.commission),
    fbaFees: sum((i) => i.fbaFee),
    otherTransactionFees: sum((i) => i.otherFees),
    // Anything at transaction level that no item explains — an Adjustment or an ads
    // charge has no items at all, and its whole value lands here.
    other: round2(total - sum((i) => i.total)),
    total,
    // Stable across DEFERRED → DEFERRED_RELEASED → RELEASED. A refund carries no shipment
    // id, so it falls back to the amount, which is what distinguishes two refunds on one
    // order. Transactions with no order at all (ads, adjustments) key on their own id —
    // they are one-offs, not a lifecycle.
    dedupKey: orderId
      ? `${orderId}|${type}|${shipmentId ?? total.toFixed(2)}`
      : `txn|${t.transactionId ?? `${type}|${t.postedDate ?? ""}|${total.toFixed(2)}`}`,
    breakdown: t.breakdowns ?? null,
    sku: items.find((i) => i.sku)?.sku ?? null,
    quantity: sum((i) => i.quantity),
    items,
  };
}

type ListResponse = { payload?: { transactions?: ApiTransaction[]; nextToken?: string }; transactions?: ApiTransaction[]; nextToken?: string };

/** Every transaction posted since `since`, following nextToken. */
export async function fetchTransactions(cred: Credential, since: Date): Promise<TxnRow[]> {
  if (!cred.marketplaceId) return [];
  const out: TxnRow[] = [];
  let next: string | undefined;
  for (let page = 0; page < 200; page++) {
    const qs = next
      ? new URLSearchParams({ nextToken: next })
      : new URLSearchParams({ postedAfter: since.toISOString(), marketplaceId: cred.marketplaceId });
    // listTransactions: 0.5 req/s sustained → pace at 2.1s between pages.
    const res = await paced(`finances:txns:${credKey(cred)}`, 2100, () =>
      spJson<ListResponse>(cred, `/finances/2024-06-19/transactions?${qs}`));
    const batch = res.payload?.transactions ?? res.transactions ?? [];
    for (const t of batch) out.push(toTxnRow(t));
    next = res.payload?.nextToken ?? res.nextToken;
    if (!next) break;
  }
  return out;
}
