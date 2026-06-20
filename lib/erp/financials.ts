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
}): Promise<AccountBalance[]> {
  const filters = [
    eq(journalEntries.organizationId, opts.orgId),
    eq(journalEntries.status, "POSTED"),
  ];
  if (opts.from) filters.push(gte(journalEntries.date, opts.from));
  if (opts.to) filters.push(lte(journalEntries.date, opts.to));

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

/** Natural-sign amount for a statement line: debit balance for DEBIT-normal
 *  accounts (assets/expenses), credit balance for CREDIT-normal accounts
 *  (liabilities/equity/revenue). Always returned as a positive presentation
 *  figure unless the account is in an abnormal position. */
export function naturalAmount(b: AccountBalance): number {
  return b.normalBalance === "CREDIT" ? -b.balance : b.balance;
}
