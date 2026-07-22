import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, bankAccounts } from "@/db/schema";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";

export type CashLine = { code: string; nameAr: string; amount: number; sign: 1 | -1 };

/**
 * Non-cash cash-flow category based on account type + code prefix.
 * Typical Arabic CoA: 11-14xx = current assets, 15-19xx = fixed/non-current,
 * 21-24xx = current liabilities, 25-29xx = LT liabilities, 3xxx = equity.
 */
function category(code: string, type: string): "operating" | "investing" | "financing" {
  if (type === "ASSET") {
    if (code < "15") return "operating";
    return "investing";
  }
  if (type === "LIABILITY") {
    if (code < "25") return "operating";
    return "financing";
  }
  if (type === "EQUITY") return "financing";
  return "operating";
}

/**
 * Which accounts count as CASH: the org's cash-box (1101) and bank (1102) subtrees
 * per the account-role config, plus any GL account linked to a bank account. The old
 * "starts with 110" rule also swallowed AR (1103), Inventory (1104) and input VAT
 * (1107), turning every figure into "change in current assets" instead of cash.
 */
async function cashPredicate(orgId: string): Promise<(code: string, type: string) => boolean> {
  const rc = await resolveAccountCodes(orgId, ["1101", "1102"]);
  const bankRows = await db.select({ code: accounts.code })
    .from(bankAccounts).innerJoin(accounts, eq(accounts.id, bankAccounts.glAccountId))
    .where(eq(bankAccounts.organizationId, orgId));
  const bankCodes = new Set(bankRows.map((r) => r.code));
  return (code, type) => type === "ASSET" &&
    (code.startsWith(rc["1101"]) || code.startsWith(rc["1102"]) || bankCodes.has(code));
}

export type CashFlow = {
  netIncome: number;
  operating: CashLine[];
  investing: CashLine[];
  financing: CashLine[];
  opTotal: number;
  invTotal: number;
  finTotal: number;
  netCashChange: number;
  cashBegin: number;
  cashEnd: number;
};

/** Indirect-method cash-flow statement for one org over [startDate, endDate]. */
export async function getCashFlow(orgId: string, startDate: Date, endDate: Date): Promise<CashFlow> {
  // excludeClosing: the year-closing entry moves P&L into retained earnings without
  // any cash movement. Left in, it zeroes `netIncome` for a closed period and shows
  // the profit as a retained-earnings movement in financing instead — right total,
  // wrong section. Dropping it keeps the profit in operating, where it belongs.
  const periodBalances = await accountBalances({ orgId, from: startDate, to: endDate, excludeClosing: true });

  const beginDate = new Date(startDate);
  beginDate.setDate(beginDate.getDate() - 1);
  beginDate.setHours(23, 59, 59);
  const beginBalances = await accountBalances({ orgId, to: beginDate });

  const netIncome =
    periodBalances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
    periodBalances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);

  const isCash = await cashPredicate(orgId);
  const bsAccounts = periodBalances.filter((b) => b.type === "ASSET" || b.type === "LIABILITY" || b.type === "EQUITY");
  const operating: CashLine[] = [];
  const investing: CashLine[] = [];
  const financing: CashLine[] = [];
  for (const b of bsAccounts) {
    if (isCash(b.code, b.type)) continue;
    const cat = category(b.code, b.type);
    const cashImpact = -b.balance; // asset↑ uses cash; liability/equity↑ provides cash
    if (cashImpact === 0) continue;
    const line: CashLine = { code: b.code, nameAr: b.nameAr, amount: Math.abs(cashImpact), sign: cashImpact > 0 ? 1 : -1 };
    if (cat === "operating") operating.push(line);
    else if (cat === "investing") investing.push(line);
    else financing.push(line);
  }
  const sortLines = (arr: CashLine[]) => arr.sort((a, b) => a.code.localeCompare(b.code));
  sortLines(operating); sortLines(investing); sortLines(financing);

  const sumLines = (arr: CashLine[]) => arr.reduce((s, l) => s + l.sign * l.amount, 0);
  const opTotal = sumLines(operating) + netIncome;
  const invTotal = sumLines(investing);
  const finTotal = sumLines(financing);
  const netCashChange = opTotal + invTotal + finTotal;
  const cashBegin = beginBalances
    .filter((b) => isCash(b.code, b.type))
    .reduce((s, b) => s + naturalAmount(b), 0);
  const cashEnd = cashBegin + netCashChange;

  return { netIncome, operating, investing, financing, opTotal, invTotal, finTotal, netCashChange, cashBegin, cashEnd };
}
