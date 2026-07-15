import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { getCashFlow } from "@/lib/erp/cashflow";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type StmtLine = { code: string; name: string; amount: number };

export type IncomeStatement = {
  from: string; to: string;
  revenue: StmtLine[]; expense: StmtLine[];
  totalRevenue: number; totalExpense: number; net: number;
};

export type BalanceSheet = {
  asOf: string;
  assets: StmtLine[]; liabilities: StmtLine[]; equity: StmtLine[];
  totalAssets: number; totalLiabilities: number; totalEquity: number;
};

export type CashFlowStatement = {
  from: string; to: string;
  operating: StmtLine[]; investing: StmtLine[]; financing: StmtLine[];
  opTotal: number; invTotal: number; finTotal: number;
  netChange: number; cashBegin: number; cashEnd: number;
};

const YEAR_START = () => `${new Date().getUTCFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

/** Income statement — same computation as the web reports page. */
export async function incomeStatement(orgId: string, from?: string, to?: string): Promise<IncomeStatement> {
  const f = from || YEAR_START();
  const t = to || today();
  const balances = await accountBalances({ orgId, from: new Date(f), to: new Date(`${t}T23:59:59`) });
  const pick = (type: string) => balances.filter((b) => b.type === type)
    .map((b) => ({ code: b.code, name: b.nameAr, amount: round2(naturalAmount(b)) })).filter((b) => b.amount !== 0);
  const revenue = pick("REVENUE");
  const expense = pick("EXPENSE");
  const totalRevenue = round2(revenue.reduce((s, b) => s + b.amount, 0));
  const totalExpense = round2(expense.reduce((s, b) => s + b.amount, 0));
  return { from: f, to: t, revenue, expense, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) };
}

/** Balance sheet as of a date — equity includes the period's net income (matches web). */
export async function balanceSheet(orgId: string, asOf?: string): Promise<BalanceSheet> {
  const t = asOf || today();
  const balances = await accountBalances({ orgId, to: new Date(`${t}T23:59:59`) });
  const pick = (type: string) => balances.filter((b) => b.type === type)
    .map((b) => ({ code: b.code, name: b.nameAr, amount: round2(naturalAmount(b)) })).filter((b) => b.amount !== 0);
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const netIncome =
    balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0) -
    balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
  if (Math.abs(netIncome) > 0.005) equity.push({ code: "—", name: "صافي ربح الفترة", amount: round2(netIncome) });
  return {
    asOf: t, assets, liabilities, equity,
    totalAssets: round2(assets.reduce((s, b) => s + b.amount, 0)),
    totalLiabilities: round2(liabilities.reduce((s, b) => s + b.amount, 0)),
    totalEquity: round2(equity.reduce((s, b) => s + b.amount, 0)),
  };
}

/** Cash-flow statement — reuses the web engine. */
export async function cashFlowStatement(orgId: string, from?: string, to?: string): Promise<CashFlowStatement> {
  const f = from || YEAR_START();
  const t = to || today();
  const cf = await getCashFlow(orgId, new Date(f), new Date(`${t}T23:59:59`));
  const map = (ls: { code: string; nameAr: string; amount: number }[]) => ls.map((l) => ({ code: l.code, name: l.nameAr, amount: round2(l.amount) }));
  return {
    from: f, to: t,
    operating: map(cf.operating), investing: map(cf.investing), financing: map(cf.financing),
    opTotal: round2(cf.opTotal), invTotal: round2(cf.invTotal), finTotal: round2(cf.finTotal),
    netChange: round2(cf.netCashChange), cashBegin: round2(cf.cashBegin), cashEnd: round2(cf.cashEnd),
  };
}
