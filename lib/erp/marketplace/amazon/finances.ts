import "server-only";
import { spJson, paced, credKey } from "./client";
import type { Credential } from "../connector";
import type { MarketplaceBalance } from "../dto";

/**
 * What Amazon says it is holding — the number on the seller's Payments Dashboard.
 *
 * Everything else in this connector is report-driven: the settlement flat file tells us
 * what Amazon PAID, weeks after the fact. Nothing told us what Amazon still HAS, so the
 * wallet balance in the ledger had no counterparty to be checked against. A ledger with
 * no external number to reconcile to is a ledger you have to take on faith.
 *
 * Amazon's own recipe (docs: "Retrieve your current balance"): list the financial event
 * groups and take the ones still Open. Straight from the API model, on
 * `FinancialEventGroup.OriginalTotal`:
 *
 *   "For a closed financial group, this is the total amount of a disbursement or a
 *    charge amount. For an OPEN financial event group, this is the current balance."
 *
 * So the open group's OriginalTotal is the balance, and BeginningBalance is what it
 * opened with — both are kept, because a difference is much easier to explain when you
 * can see whether it came from the carried-over balance or from this period's activity.
 *
 * More than one group can be open at once (an account settling in several currencies),
 * hence a list rather than a single figure.
 */

type Currency = { CurrencyCode?: string; CurrencyAmount?: number };
type Group = {
  FinancialEventGroupId?: string;
  ProcessingStatus?: string;
  FundTransferStatus?: string;
  OriginalTotal?: Currency;
  ConvertedTotal?: Currency;
  BeginningBalance?: Currency;
  AccountTail?: string;
  FinancialEventGroupStart?: string;
  FinancialEventGroupEnd?: string;
};
type GroupsResponse = { payload?: { FinancialEventGroupList?: Group[]; NextToken?: string } };

const date = (s?: string) => (s ? new Date(s) : null);

/** Pure: an OPEN financial event group → the balance row. Closed groups return null —
 *  their OriginalTotal is a disbursement amount, not a balance, and treating it as one
 *  would silently report a payout as money still on the account. */
export function groupToBalance(g: Group): MarketplaceBalance | null {
  if (g.ProcessingStatus !== "Open") return null;
  const total = g.OriginalTotal ?? {};
  return {
    groupId: g.FinancialEventGroupId ?? "",
    currency: total.CurrencyCode ?? g.BeginningBalance?.CurrencyCode ?? "",
    balance: Number(total.CurrencyAmount ?? 0) || 0,
    openingBalance: Number(g.BeginningBalance?.CurrencyAmount ?? 0) || 0,
    periodStart: date(g.FinancialEventGroupStart),
    periodEnd: date(g.FinancialEventGroupEnd),
    fundTransferStatus: g.FundTransferStatus ?? null,
    accountTail: g.AccountTail ?? null,
  };
}

// listFinancialEventGroups is 0.5 req/s (burst 30) — its own gate, per seller account.
const GATE_MS = 2100;
// The window only has to be wide enough to contain the open group. Amazon caps the range
// at 180 days and rejects a StartedAfter later than two minutes ago; 180 days back clears
// both by a mile.
const WINDOW_DAYS = 180;

/** The seller's current balance per open settlement group. One request, no report. */
export async function fetchBalance(cred: Credential): Promise<MarketplaceBalance[]> {
  const after = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    FinancialEventGroupStartedAfter: after.toISOString(),
    MaxResultsPerPage: "100",
  });
  const res = await paced(`amazon-finances:${credKey(cred)}`, GATE_MS, () =>
    spJson<GroupsResponse>(cred, `/finances/v0/financialEventGroups?${qs}`));
  const out: MarketplaceBalance[] = [];
  for (const g of res.payload?.FinancialEventGroupList ?? []) {
    const b = groupToBalance(g);
    if (b) out.push(b);
  }
  return out;
}
