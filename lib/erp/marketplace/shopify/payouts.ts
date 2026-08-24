import "server-only";
import type { Credential } from "../connector";
import type { DateRange } from "../dto";
import type { SettlementTxn } from "@/lib/erp/amazon-settlement";
import { shopifyGraphql, paginate } from "./client";

// Shopify Payments balance transactions → the neutral SettlementTxn shape the shared
// settlement engine already consumes (Dr wallet 1110 / Cr receivable + fees; payouts
// Dr bank / Cr wallet). Charges collect an order's receivable (matched by order name,
// which Phase-1 orders store as externalOrderId); payouts are bank transfers.
//
// ponytail: refunds/disputes/adjustments are booked as aggregate marketplace
// expense-vs-wallet rows (type left un-"Refund" so the qty-dependent return cycle is
// skipped — Shopify balance txns carry no line qty). Net income + the wallet balance
// stay correct; a refund shows as marketplace cost rather than a revenue reversal.
// Upgrade path: pull the refund's order line qty to run the full credit-note cycle.

const PAYOUTS_QUERY = `query ShopifyPayouts($cursor: String) {
  shopifyPaymentsAccount {
    balanceTransactions(first: 100, after: $cursor) {
      nodes {
        id
        type
        transactionDate
        amount { amount }
        fee { amount }
        net { amount }
        associatedOrder { name }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

type MoneyV2 = { amount: string | null } | null;
type BalanceTxnNode = {
  id: string; type: string; transactionDate: string;
  amount: MoneyV2; fee: MoneyV2; net: MoneyV2;
  associatedOrder: { name: string | null } | null;
};
type PayoutsData = { shopifyPaymentsAccount: { balanceTransactions: { nodes: BalanceTxnNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null };

const money = (m: MoneyV2) => Number(m?.amount ?? 0) || 0;

/** Pure: one Shopify balance transaction → a SettlementTxn. Amazon's sign convention:
 *  fees are stored NEGATIVE (deductions), productSales POSITIVE, total = net cash. */
export function balanceTxnToSettlement(t: BalanceTxnNode): SettlementTxn {
  const gross = money(t.amount);
  const fee = money(t.fee);
  const net = t.net ? money(t.net) : gross - fee;
  const date = t.transactionDate ? new Date(t.transactionDate) : null;
  const orderName = t.associatedOrder?.name ?? "";
  const kind = (t.type || "").toLowerCase();

  // Charge → collect that order's receivable (per-order entry, matched by order name).
  // Payout → bank transfer (Dr bank / Cr wallet). Everything else (refund, dispute,
  // adjustment, fee) → an aggregate wallet-vs-expense row.
  const isCharge = kind === "charge";
  const isPayout = kind === "payout";
  const type = isCharge ? "Order" : isPayout ? "Transfer" : "Adjustment"; // NOT "Refund" → skips qty-based return cycle

  const base = {
    postedAt: date, settlementId: t.id, orderId: isCharge ? orderName : "", sku: "",
    description: t.type || "", quantity: 0, status: "Released", releaseDate: date,
    currency: (t.amount as { currencyCode?: string })?.currencyCode ?? null,
    shippingCredits: 0, promotionalRebates: 0, fbaFees: 0, otherTransactionFees: 0, total: net,
  };
  if (isCharge) return { ...base, type, productSales: gross, sellingFees: -fee, other: 0 };
  // Transfer + Adjustment: no per-order receivable; the whole net flows through the wallet.
  return { ...base, type, productSales: 0, sellingFees: 0, other: 0 };
}

export async function fetchSettlements(cred: Credential, _range: DateRange): Promise<SettlementTxn[]> {
  // ponytail: balanceTransactions has no server-side date filter here; the settlement
  // engine dedups by id and only posts on/after the go-live date, so pulling the recent
  // window is safe. Add a date filter if the volume ever needs it.
  void _range;
  const nodes = await paginate<BalanceTxnNode, PayoutsData>(
    cred, PAYOUTS_QUERY, {},
    (d) => d.shopifyPaymentsAccount?.balanceTransactions ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
  );
  return nodes.map(balanceTxnToSettlement);
}
