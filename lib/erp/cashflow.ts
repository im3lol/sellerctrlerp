import { accountBalances, naturalAmount } from "@/lib/erp/financials";

export type CashLine = { code: string; nameAr: string; amount: number; sign: 1 | -1 };

/**
 * Cash-flow category based on account type + code prefix.
 * Typical Arabic CoA: 110x = cash/bank, 11-14xx = current assets,
 * 15-19xx = fixed/non-current, 21-24xx = current liabilities,
 * 25-29xx = LT liabilities, 3xxx = equity.
 */
function category(code: string, type: string): "cash" | "operating" | "investing" | "financing" {
  if (type === "ASSET") {
    if (code.startsWith("110")) return "cash";
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
  const periodBalances = await accountBalances({ orgId, from: startDate, to: endDate });

  const beginDate = new Date(startDate);
  beginDate.setDate(beginDate.getDate() - 1);
  beginDate.setHours(23, 59, 59);
  const beginBalances = await accountBalances({ orgId, to: beginDate });

  const netIncome =
    periodBalances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
    periodBalances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);

  const bsAccounts = periodBalances.filter((b) => b.type === "ASSET" || b.type === "LIABILITY" || b.type === "EQUITY");
  const operating: CashLine[] = [];
  const investing: CashLine[] = [];
  const financing: CashLine[] = [];
  for (const b of bsAccounts) {
    const cat = category(b.code, b.type);
    if (cat === "cash") continue;
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
    .filter((b) => b.type === "ASSET" && b.code.startsWith("110"))
    .reduce((s, b) => s + naturalAmount(b), 0);
  const cashEnd = cashBegin + netCashChange;

  return { netIncome, operating, investing, financing, opTotal, invTotal, finTotal, netCashChange, cashBegin, cashEnd };
}
