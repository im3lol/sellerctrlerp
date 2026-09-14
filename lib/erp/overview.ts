import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { salesInvoices, purchaseInvoices, customers, suppliers } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { resolveAccountCodes } from "@/lib/erp/accounting-config";
import { getExpiryReport } from "@/lib/erp/expiry";
import { liveInvoice } from "@/lib/erp/invoice-status";

export type ErpOverview = {
  income: number;
  expense: number;
  net: number;
  cash: number;
  ar: number;
  ap: number;
  inventoryValue: number;
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  salesMonth: number;
  salesCount: number;
  purchasesMonth: number;
  purchasesCount: number;
  nearExpiryCount: number;
  expiredCount: number;
  topItems: { name: string; value: number }[];
  /** Revenue vs expenses per month over the last 6 months (oldest → newest). */
  pnlTrend: { label: string; revenue: number; expense: number }[];
  overdueAR: number;
  overdueAP: number;
  recentSales: { number: string; customer: string; amount: number; date: Date }[];
  recentPurchases: { number: string; supplier: string; amount: number; date: Date }[];
};

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export type PendingWork = { jeDraft: number; siDraft: number; piDraft: number; soAwaiting: number; poAwaiting: number };

/** All open document-workflow counts in one round-trip (kept out of getErpOverview
 *  to avoid widening its parallel fan-out on the session pooler). */
export async function getPendingWork(orgId: string): Promise<PendingWork> {
 return withOrgScope(orgId, false, async () => {
  const [row] = (await db.execute<Record<keyof PendingWork, number>>(sql`
    SELECT
      (SELECT count(*) FROM journal_entries  WHERE organization_id = ${orgId} AND status = 'DRAFT')::int AS "jeDraft",
      (SELECT count(*) FROM sales_invoices   WHERE organization_id = ${orgId} AND status = 'DRAFT')::int AS "siDraft",
      (SELECT count(*) FROM purchase_invoices WHERE organization_id = ${orgId} AND status = 'DRAFT')::int AS "piDraft",
      (SELECT count(*) FROM sales_orders     WHERE organization_id = ${orgId} AND status IN ('CONFIRMED','PARTIALLY_DELIVERED'))::int AS "soAwaiting",
      (SELECT count(*) FROM purchase_orders  WHERE organization_id = ${orgId} AND status IN ('CONFIRMED','PARTIALLY_RECEIVED'))::int AS "poAwaiting"
  `)).rows as Record<keyof PendingWork, number>[];
  return { jeDraft: row?.jeDraft ?? 0, siDraft: row?.siDraft ?? 0, piDraft: row?.piDraft ?? 0, soAwaiting: row?.soAwaiting ?? 0, poAwaiting: row?.poAwaiting ?? 0 };
 });
}

function monthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Build a 6-month revenue/expense series from posted GL, filling empty months. */
async function pnlTrend(orgId: string): Promise<{ label: string; revenue: number; expense: number }[]> {
  const now = new Date();
  const since6 = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rows = (await db.execute<{ ym: string; revenue: string; expense: string }>(sql`
    SELECT to_char(je.date, 'YYYY-MM') AS ym,
           COALESCE(sum(CASE WHEN a.type = 'REVENUE' THEN jl.credit - jl.debit ELSE 0 END), 0) AS revenue,
           COALESCE(sum(CASE WHEN a.type = 'EXPENSE' THEN jl.debit - jl.credit ELSE 0 END), 0) AS expense
    FROM journal_entry_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.organization_id = ${orgId} AND je.status = 'POSTED' AND je.date >= ${since6}
    GROUP BY ym
  `)).rows as { ym: string; revenue: string; expense: string }[];
  const byMonth = new Map(rows.map((r) => [r.ym, r]));

  const out: { label: string; revenue: number; expense: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const r = byMonth.get(key);
    out.push({ label: AR_MONTHS[d.getMonth()], revenue: Number(r?.revenue ?? 0), expense: Number(r?.expense ?? 0) });
  }
  return out;
}

/**
 * Single source of truth for the ERP "overview" figures (financial + inventory +
 * this-month trade + alerts) for one org. Shared by the ERP dashboard
 * (`/dashboard`) and the unified home dashboard (`/dashboard`) so both read
 * the same numbers. All queries are org-scoped.
 */
export async function getErpOverview(orgId: string): Promise<ErpOverview> {
 return withOrgScope(orgId, false, async () => {
  const since = monthStart();
  const today = new Date();

  const [invResult, balances, [sm], [pm], expiry, trend, overdueSales, overduePurch, recentSales, recentPurchases] = await Promise.all([
    db.execute<{ name: string; min_stock: string; qty: string; val: string }>(sql`
      SELECT COALESCE(i.name_ar, i.code) AS name, i.min_stock,
             COALESCE(s.qty, 0) AS qty, COALESCE(s.val, 0) AS val
      FROM items i
      LEFT JOIN (
        SELECT item_id, SUM(bq) AS qty, SUM(bv) AS val FROM (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq, balance_value bv
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
        ) t GROUP BY item_id
      ) s ON s.item_id = i.id
      WHERE i.organization_id = ${orgId} AND i.is_active = true
    `),
    accountBalances({ orgId }),
    db.select({ n: sql<number>`count(*)`, t: sql<string>`coalesce(sum(${salesInvoices.totalAmount}),0)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status), gte(salesInvoices.date, since))),
    db.select({ n: sql<number>`count(*)`, t: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount}),0)` })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), liveInvoice(purchaseInvoices.status), gte(purchaseInvoices.date, since))),
    getExpiryReport(orgId, {}),
    pnlTrend(orgId),
    db.select({ total: sql<string>`coalesce(sum(${salesInvoices.balanceDue}),0)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status), lt(salesInvoices.dueDate, today))),
    db.select({ total: sql<string>`coalesce(sum(${purchaseInvoices.balanceDue}),0)` })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), liveInvoice(purchaseInvoices.status), lt(purchaseInvoices.dueDate, today))),
    db.select({ number: salesInvoices.number, amount: salesInvoices.totalAmount, date: salesInvoices.date, customer: customers.nameAr })
      .from(salesInvoices)
      .leftJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status)))
      .orderBy(sql`${salesInvoices.date} desc`)
      .limit(5),
    db.select({ number: purchaseInvoices.number, amount: purchaseInvoices.totalAmount, date: purchaseInvoices.date, supplier: suppliers.nameAr })
      .from(purchaseInvoices)
      .leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .where(and(eq(purchaseInvoices.organizationId, orgId), liveInvoice(purchaseInvoices.status)))
      .orderBy(sql`${purchaseInvoices.date} desc`)
      .limit(5),
  ]);

  const invRows = invResult.rows as { name: string; min_stock: string; qty: string; val: string }[];
  const income = balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0);
  const expense = balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
  const byCode = Object.fromEntries(balances.map((b) => [b.code, b.balance]));
  // Respect per-org account overrides: read each role's balance from its effective code.
  const rc = await resolveAccountCodes(orgId, ["1101", "1102", "1103", "2101"]);

  const totalValue = invRows.reduce((s, r) => s + Number(r.val), 0);
  const lowStock = invRows.filter((r) => Number(r.min_stock) > 0 && Number(r.qty) <= Number(r.min_stock) && Number(r.qty) > 0).length;
  const outOfStock = invRows.filter((r) => Number(r.qty) <= 0).length;
  const topItems = [...invRows]
    .filter((r) => Number(r.val) > 0)
    .sort((a, b) => Number(b.val) - Number(a.val))
    .slice(0, 6)
    .map((r) => ({ name: r.name, value: Number(r.val) }));

  return {
    income,
    expense,
    net: income - expense,
    cash: (byCode[rc["1101"]] ?? 0) + (byCode[rc["1102"]] ?? 0),
    ar: byCode[rc["1103"]] ?? 0,
    ap: -(byCode[rc["2101"]] ?? 0),
    inventoryValue: totalValue,
    totalItems: invRows.length,
    lowStock,
    outOfStock,
    salesMonth: Number(sm.t),
    salesCount: Number(sm.n),
    purchasesMonth: Number(pm.t),
    purchasesCount: Number(pm.n),
    nearExpiryCount: expiry.totals.nearCount,
    expiredCount: expiry.totals.expiredCount,
    topItems,
    pnlTrend: trend,
    overdueAR: Number(overdueSales[0]?.total ?? 0),
    overdueAP: Number(overduePurch[0]?.total ?? 0),
    recentSales: recentSales.map((r) => ({ number: r.number, customer: r.customer ?? "—", amount: Number(r.amount), date: r.date })),
    recentPurchases: recentPurchases.map((r) => ({ number: r.number, supplier: r.supplier ?? "—", amount: Number(r.amount), date: r.date })),
  };
 });
}

/** Daily POSTED sales-invoice totals for the last `days` days (continuous 0-filled series). */
export async function getSalesTrend(orgId: string, days = 30): Promise<{ label: string; value: number }[]> {
 return withOrgScope(orgId, false, async () => {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await db
    .select({ d: sql<string>`to_char(${salesInvoices.date}, 'YYYY-MM-DD')`, t: sql<string>`coalesce(sum(${salesInvoices.totalAmount}),0)` })
    .from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status), gte(salesInvoices.date, since)))
    .groupBy(sql`to_char(${salesInvoices.date}, 'YYYY-MM-DD')`);
  const byDay = new Map(rows.map((r) => [r.d, Number(r.t)]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.now() - (days - 1 - i) * 864e5);
    return { label: day.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }), value: byDay.get(day.toISOString().slice(0, 10)) ?? 0 };
  });
 });
}

export type DashboardInsights = {
  /** Invoiced this month, and over the same number of days last month. */
  salesMtd: number; salesPrev: number; invoicesMtd: number;
  /** Net of VAT, and what the goods sold cost (stock ledger, OUT − returns) — gross profit. */
  netSalesMtd: number; cogsMtd: number;
  /** Money into / out of the cash-box and bank subtrees this month (posted entries). */
  cashIn: number; cashOut: number;
  channels: { channel: string; orders: number; value: number }[];
  topItems: { name: string; qty: number; value: number }[];
  topCustomers: { name: string; invoices: number; value: number }[];
  /** Released settlement lines, last 30 days: product sales, platform fees, net paid out. */
  mktSales: number; mktFees: number; mktNet: number;
  pendingReturns: number; reimbPending: number; reimbAmount: number;
};

/**
 * Everything the dashboard shows beyond getErpOverview, in ONE round trip — scalar
 * subqueries and json_agg'd top-5 lists. Invoices count when they're real (liveInvoice's
 * rule: not a draft, not cancelled), so a paid invoice doesn't vanish from sales.
 * ponytail: cash in/out includes transfers between the org's own cash accounts; split them
 * out if anyone reads it as income.
 */
export async function getDashboardInsights(orgId: string): Promise<DashboardInsights> {
 return withOrgScope(orgId, false, async () => {
  const now = new Date();
  const m0 = monthStart();
  const p0 = new Date(m0.getFullYear(), m0.getMonth() - 1, 1);
  const pEnd = new Date(p0.getTime() + (now.getTime() - m0.getTime()));
  const d30 = new Date(now.getTime() - 30 * 864e5);
  const rc = await resolveAccountCodes(orgId, ["1101", "1102"]);
  const cashAcc = sql`(a.code LIKE ${`${rc["1101"]}%`} OR a.code LIKE ${`${rc["1102"]}%`})`;
  const live = sql`status NOT IN ('DRAFT','CANCELLED')`;

  const [r] = (await db.execute<Record<string, unknown>>(sql`
    SELECT
      (SELECT coalesce(sum(total_amount), 0) FROM sales_invoices WHERE organization_id = ${orgId} AND ${live} AND date >= ${m0}) AS "salesMtd",
      (SELECT coalesce(sum(total_amount), 0) FROM sales_invoices WHERE organization_id = ${orgId} AND ${live} AND date >= ${p0} AND date < ${pEnd}) AS "salesPrev",
      (SELECT count(*) FROM sales_invoices WHERE organization_id = ${orgId} AND ${live} AND date >= ${m0})::int AS "invoicesMtd",
      (SELECT coalesce(sum(total_amount - tax_amount), 0) FROM sales_invoices WHERE organization_id = ${orgId} AND ${live} AND date >= ${m0}) AS "netSalesMtd",
      (SELECT coalesce(sum(CASE WHEN type = 'OUT' THEN total_cost ELSE -total_cost END), 0) FROM stock_movements
        WHERE organization_id = ${orgId} AND reference_type IN ('DELIVERY','SALES_INVOICE','SALES_RETURN') AND date >= ${m0}) AS "cogsMtd",
      (SELECT coalesce(sum(jl.debit), 0) FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.organization_id = ${orgId} AND je.status = 'POSTED' AND je.date >= ${m0} AND ${cashAcc}) AS "cashIn",
      (SELECT coalesce(sum(jl.credit), 0) FROM journal_entry_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN accounts a ON a.id = jl.account_id
        WHERE je.organization_id = ${orgId} AND je.status = 'POSTED' AND je.date >= ${m0} AND ${cashAcc}) AS "cashOut",
      (SELECT coalesce(json_agg(t), '[]') FROM (
        SELECT channel, count(*)::int AS orders, coalesce(sum(total_amount), 0)::float AS value FROM sales_orders
        WHERE organization_id = ${orgId} AND status NOT IN ('DRAFT','CANCELLED') AND date >= ${m0}
        GROUP BY channel ORDER BY 3 DESC) t) AS "channels",
      (SELECT coalesce(json_agg(t), '[]') FROM (
        SELECT coalesce(i.name_ar, i.code) AS name, sum(l.quantity)::float AS qty, sum(l.total_amount)::float AS value
        FROM sales_invoice_lines l JOIN sales_invoices s ON s.id = l.sales_invoice_id JOIN items i ON i.id = l.item_id
        WHERE s.organization_id = ${orgId} AND s.status NOT IN ('DRAFT','CANCELLED') AND s.date >= ${m0}
        GROUP BY i.id ORDER BY 3 DESC LIMIT 5) t) AS "topItems",
      (SELECT coalesce(json_agg(t), '[]') FROM (
        SELECT coalesce(c.name_ar, '—') AS name, count(*)::int AS invoices, sum(s.total_amount)::float AS value
        FROM sales_invoices s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.organization_id = ${orgId} AND s.status NOT IN ('DRAFT','CANCELLED') AND s.date >= ${m0}
        GROUP BY c.id, c.name_ar ORDER BY 3 DESC LIMIT 5) t) AS "topCustomers",
      (SELECT coalesce(sum(product_sales), 0) FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND status = 'Released' AND posted_at >= ${d30}) AS "mktSales",
      (SELECT coalesce(-sum(selling_fees + fba_fees + other_transaction_fees), 0) FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND status = 'Released' AND posted_at >= ${d30}) AS "mktFees",
      (SELECT coalesce(sum(total), 0) FROM marketplace_settlement_txns WHERE organization_id = ${orgId} AND status = 'Released' AND posted_at >= ${d30}) AS "mktNet",
      (SELECT count(*) FROM sales_returns WHERE organization_id = ${orgId} AND status = 'DRAFT' AND channel IS NOT NULL AND channel <> 'MANUAL')::int AS "pendingReturns",
      (SELECT count(*) FROM fba_reimbursements WHERE organization_id = ${orgId} AND status = 'PENDING')::int AS "reimbPending",
      (SELECT coalesce(sum(amount_total), 0) FROM fba_reimbursements WHERE organization_id = ${orgId} AND status = 'PENDING') AS "reimbAmount"
  `)).rows;

  const n = (k: string) => Number(r?.[k] ?? 0);
  const list = <T,>(k: string): T[] => (Array.isArray(r?.[k]) ? (r[k] as T[]) : []);
  return {
    salesMtd: n("salesMtd"), salesPrev: n("salesPrev"), invoicesMtd: n("invoicesMtd"),
    netSalesMtd: n("netSalesMtd"), cogsMtd: n("cogsMtd"), cashIn: n("cashIn"), cashOut: n("cashOut"),
    channels: list("channels"), topItems: list("topItems"), topCustomers: list("topCustomers"),
    mktSales: n("mktSales"), mktFees: n("mktFees"), mktNet: n("mktNet"),
    pendingReturns: n("pendingReturns"), reimbPending: n("reimbPending"), reimbAmount: n("reimbAmount"),
  };
 });
}
