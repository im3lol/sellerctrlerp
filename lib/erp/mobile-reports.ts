import { and, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, purchaseInvoices, purchaseInvoiceLines, customers, suppliers, items } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { getCashFlow } from "@/lib/erp/cashflow";
import { buildAging, type OpenDoc } from "@/lib/erp/aging";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Posted invoices only (net of tax) — matches the web ranking reports.
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

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

// ---- Aging (تحليل أعمار الذمم) -------------------------------------------

export type AgingPartyRow = { name: string; code: string; current: number; d30: number; d60: number; d90: number; d90plus: number; total: number };
export type AgingReport = { asOf: string; grand: number; current: number; d30: number; d60: number; d90: number; d90plus: number; rows: AgingPartyRow[] };

/** Shared shaping: buildAging output → the flat mobile DTO. */
function shapeAging(open: OpenDoc[], asOf: string): AgingReport {
  const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));
  return {
    asOf, grand: round2(grand),
    current: round2(totals.current), d30: round2(totals.d30), d60: round2(totals.d60), d90: round2(totals.d90), d90plus: round2(totals.d90plus),
    rows: rows.map((r) => ({ name: r.partyName, code: r.partyCode, current: round2(r.buckets.current), d30: round2(r.buckets.d30), d60: round2(r.buckets.d60), d90: round2(r.buckets.d90), d90plus: round2(r.buckets.d90plus), total: round2(r.total) })),
  };
}

/** Customer receivables aging (أعمار ذمم العملاء) — posted invoices with a balance. */
export async function arAging(orgId: string, asOf?: string): Promise<AgingReport> {
  const t = asOf || today();
  const docs = await db.select({ partyId: customers.id, partyCode: customers.code, partyName: customers.nameAr, date: salesInvoices.date, dueDate: salesInvoices.dueDate, balanceDue: salesInvoices.balanceDue })
    .from(salesInvoices).innerJoin(customers, eq(customers.id, salesInvoices.customerId))
    .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, POSTED), gt(salesInvoices.balanceDue, "0")));
  return shapeAging(docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) })), t);
}

/** Supplier payables aging (أعمار ذمم الموردين). */
export async function apAging(orgId: string, asOf?: string): Promise<AgingReport> {
  const t = asOf || today();
  const docs = await db.select({ partyId: suppliers.id, partyCode: suppliers.code, partyName: suppliers.nameAr, date: purchaseInvoices.date, dueDate: purchaseInvoices.dueDate, balanceDue: purchaseInvoices.balanceDue })
    .from(purchaseInvoices).innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.status, POSTED), gt(purchaseInvoices.balanceDue, "0")));
  return shapeAging(docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) })), t);
}

// ---- Ranked reports (sales/purchases by customer/supplier/item) -----------

export type RankRow = { name: string; code: string; count: number; qty: number; amount: number };
export type RankReport = { from: string; to: string; total: number; rows: RankRow[] };

const range = (from?: string, to?: string) => {
  const f = from || YEAR_START(); const t = to || today();
  return { f, t, gd: gte, ld: lte, start: new Date(f), end: new Date(`${t}T23:59:59`) };
};

/** Sales grouped by customer (revenue net of tax, invoice count), highest first. */
export async function salesByCustomer(orgId: string, from?: string, to?: string): Promise<RankReport> {
  const { f, t, start, end } = range(from, to);
  const rows = await db.select({
    name: customers.nameAr, code: customers.code,
    count: sql<number>`count(${salesInvoices.id})`,
    amount: sql<string>`coalesce(sum(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount}), 0)`,
  }).from(customers)
    .innerJoin(salesInvoices, and(eq(salesInvoices.customerId, customers.id), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, start), lte(salesInvoices.date, end)))
    .where(eq(customers.organizationId, orgId))
    .groupBy(customers.id, customers.nameAr, customers.code);
  const list = rows.map((r) => ({ name: r.name ?? r.code, code: r.code, count: Number(r.count), qty: 0, amount: round2(Number(r.amount)) })).sort((a, b) => b.amount - a.amount);
  return { from: f, to: t, total: round2(list.reduce((s, r) => s + r.amount, 0)), rows: list };
}

/** Purchases grouped by supplier (net of tax, invoice count), highest first. */
export async function purchasesBySupplier(orgId: string, from?: string, to?: string): Promise<RankReport> {
  const { f, t, start, end } = range(from, to);
  const rows = await db.select({
    name: suppliers.nameAr, code: suppliers.code,
    count: sql<number>`count(${purchaseInvoices.id})`,
    amount: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount}), 0)`,
  }).from(suppliers)
    .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.supplierId, suppliers.id), inArray(purchaseInvoices.status, POSTED), gte(purchaseInvoices.date, start), lte(purchaseInvoices.date, end)))
    .where(eq(suppliers.organizationId, orgId))
    .groupBy(suppliers.id, suppliers.nameAr, suppliers.code);
  const list = rows.map((r) => ({ name: r.name ?? r.code, code: r.code, count: Number(r.count), qty: 0, amount: round2(Number(r.amount)) })).sort((a, b) => b.amount - a.amount);
  return { from: f, to: t, total: round2(list.reduce((s, r) => s + r.amount, 0)), rows: list };
}

/** Sales grouped by item (qty sold + revenue), highest revenue first. */
export async function salesByItem(orgId: string, from?: string, to?: string): Promise<RankReport> {
  const { f, t, start, end } = range(from, to);
  const rows = await db.select({
    name: items.nameAr, code: items.code,
    qty: sql<string>`coalesce(sum(${salesInvoiceLines.quantity}), 0)`,
    amount: sql<string>`coalesce(sum(${salesInvoiceLines.totalAmount} - ${salesInvoiceLines.taxAmount}), 0)`,
  }).from(salesInvoiceLines)
    .innerJoin(salesInvoices, and(eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, start), lte(salesInvoices.date, end), eq(salesInvoices.organizationId, orgId)))
    .leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .groupBy(items.id, items.nameAr, items.code);
  const list = rows.map((r) => ({ name: r.name ?? r.code ?? "—", code: r.code ?? "", count: 0, qty: round2(Number(r.qty)), amount: round2(Number(r.amount)) })).sort((a, b) => b.amount - a.amount);
  return { from: f, to: t, total: round2(list.reduce((s, r) => s + r.amount, 0)), rows: list };
}

/** Purchases grouped by item (qty + cost), highest first. */
export async function purchasesByItem(orgId: string, from?: string, to?: string): Promise<RankReport> {
  const { f, t, start, end } = range(from, to);
  const rows = await db.select({
    name: items.nameAr, code: items.code,
    qty: sql<string>`coalesce(sum(${purchaseInvoiceLines.quantity}), 0)`,
    amount: sql<string>`coalesce(sum(${purchaseInvoiceLines.totalAmount} - ${purchaseInvoiceLines.taxAmount}), 0)`,
  }).from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.id, purchaseInvoiceLines.purchaseInvoiceId), inArray(purchaseInvoices.status, POSTED), gte(purchaseInvoices.date, start), lte(purchaseInvoices.date, end), eq(purchaseInvoices.organizationId, orgId)))
    .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
    .groupBy(items.id, items.nameAr, items.code);
  const list = rows.map((r) => ({ name: r.name ?? r.code ?? "—", code: r.code ?? "", count: 0, qty: round2(Number(r.qty)), amount: round2(Number(r.amount)) })).sort((a, b) => b.amount - a.amount);
  return { from: f, to: t, total: round2(list.reduce((s, r) => s + r.amount, 0)), rows: list };
}
