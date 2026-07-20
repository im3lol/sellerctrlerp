import { round2 } from "@/lib/erp/money";

export type DisposalAccounts = {
  asset: string;
  accumDeprec: string;
  proceeds?: string;
  gain: string;
  loss: string;
};

export type EntryLine = { accountId: string; debit: number; credit: number; description: string };

/**
 * Build the journal lines that take a disposed asset off the books.
 *
 *   Dr cash/bank            proceeds
 *   Dr accumulated deprec.  accumulated depreciation to date
 *     Cr asset account        original purchase cost
 *     Cr gain on disposal     (or Dr loss) — the balancing figure, proceeds − NBV
 *
 * Balances for every input, which is worth seeing rather than trusting. With
 * NBV = cost − accum and gain = proceeds − NBV:
 *   gain ≥ 0 → Dr proceeds + accum          vs  Cr cost + gain
 *                                             = cost + proceeds − cost + accum ✓
 *   gain < 0 → Dr proceeds + accum + (−gain) vs  Cr cost
 *                                             = accum + nbv = cost ✓
 *
 * Zero-value lines are dropped: postEntry rejects a line with no debit and no
 * credit, and a fully-depreciated asset scrapped for nothing has both.
 */
export function buildDisposalLines(input: {
  cost: number;
  accumulatedDepreciation: number;
  proceeds: number;
  assetName: string;
  accounts: DisposalAccounts;
}): EntryLine[] {
  const { cost, accumulatedDepreciation: accum, proceeds, assetName, accounts } = input;
  const nbv = round2(cost - accum);
  const gainLoss = round2(proceeds - nbv);

  const lines: EntryLine[] = [];
  if (proceeds > 0 && accounts.proceeds) {
    lines.push({ accountId: accounts.proceeds, debit: proceeds, credit: 0, description: `متحصّلات بيع ${assetName}` });
  }
  if (accum > 0) {
    lines.push({ accountId: accounts.accumDeprec, debit: accum, credit: 0, description: `إقفال مجمع إهلاك ${assetName}` });
  }
  if (cost > 0) {
    lines.push({ accountId: accounts.asset, debit: 0, credit: cost, description: `استبعاد ${assetName}` });
  }
  if (gainLoss > 0) {
    lines.push({ accountId: accounts.gain, debit: 0, credit: gainLoss, description: `ربح بيع ${assetName}` });
  } else if (gainLoss < 0) {
    lines.push({ accountId: accounts.loss, debit: -gainLoss, credit: 0, description: `خسارة بيع ${assetName}` });
  }
  return lines;
}
