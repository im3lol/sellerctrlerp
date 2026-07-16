import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, journalEntries, journalEntryLines } from "@/db/schema";

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export type AccountBalance = {
  id: string;
  code: string;
  nameAr: string;
  type: string;
  subtype: string | null;
  normalBalance: string;
  debit: number;
  credit: number;
  /** signed debit − credit */
  balance: number;
};

/**
 * Aggregate POSTED journal-entry balances per account for an organization,
 * optionally bounded by date. One grouped SQL query (no N+1) so every financial
 * statement shares the same fast path. `from`/`to` are inclusive.
 */
export async function accountBalances(opts: {
  orgId: string;
  from?: Date;
  to?: Date;
  /**
   * Exclude the year-closing entry (Dr revenue / Cr expense → retained earnings).
   * That entry is dated ON the period end, so it falls inside any range covering
   * the closed year and nets every P&L account to zero — an income statement for
   * a closed year would report 0 profit.
   *
   * Opt-in, NOT the default: the balance sheet *needs* it included. Its
   * `netIncome` is cumulative revenue − expense with no floor, so the closing
   * entry is exactly what stops last year's profit being counted twice (once in
   * netIncome, once in retained earnings). Pass this only when you want P&L
   * activity within a window.
   */
  excludeClosing?: boolean;
}): Promise<AccountBalance[]> {
  const filters = [
    eq(journalEntries.organizationId, opts.orgId),
    eq(journalEntries.status, "POSTED"),
  ];
  if (opts.excludeClosing) {
    filters.push(sql`(${journalEntries.sourceType} is distinct from 'YEAR_CLOSING')`);
  }
  // Guard against Invalid Date (e.g. a malformed ?from=/?to= URL param): an
  // invalid Date serializes via .toISOString() inside Drizzle and throws
  // "RangeError: Invalid time value", 500-ing the whole report. Ignore it.
  const valid = (d?: Date) => (d && !Number.isNaN(d.getTime()) ? d : undefined);
  const from = valid(opts.from);
  const to = valid(opts.to);
  if (from) filters.push(gte(journalEntries.date, from));
  if (to) filters.push(lte(journalEntries.date, to));

  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      nameAr: accounts.nameAr,
      type: accounts.type,
      subtype: accounts.subtype,
      normalBalance: accounts.normalBalance,
      debit: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
    .where(and(...filters))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.code));

  return rows.map((r) => {
    const debit = Number(r.debit);
    const credit = Number(r.credit);
    return { ...r, debit, credit, balance: debit - credit };
  });
}

/** Natural-sign amount for a statement line: a debit balance reads positive for
 *  assets/expenses, a credit balance reads positive for liabilities/equity/revenue.
 *  An account sitting on the wrong side reads negative.
 *
 *  Signed by `type`, deliberately NOT by `normalBalance` — every caller buckets by
 *  `type`, so the sign has to agree with the bucket or the line lands in a total
 *  with the wrong sign. The two only differ on a contra account, which is exactly
 *  where getting it wrong costs the most:
 *
 *    accumulated depreciation (ASSET, CREDIT-normal, balance −30,000)
 *      by normalBalance → +30,000, ADDED to total assets (assets overstate by 60k
 *                         and the balance sheet stops balancing)
 *      by type          → −30,000, correctly deducted from total assets
 *
 *    sales discounts (REVENUE, DEBIT-normal, balance +500)
 *      by normalBalance → +500, inflating revenue by the discount given
 *      by type          → −500, correctly reducing revenue
 */
export function naturalAmount(b: AccountBalance): number {
  return b.type === "LIABILITY" || b.type === "EQUITY" || b.type === "REVENUE" ? -b.balance : b.balance;
}
