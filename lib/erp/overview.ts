import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices, customers, suppliers } from "@/db/schema";
import { accountBalances, naturalAmount } from "@/lib/erp/financials";
import { getExpiryReport } from "@/lib/erp/expiry";

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
 * (`/erp/dashboard`) and the unified home dashboard (`/dashboard`) so both read
 * the same numbers. All queries are org-scoped.
 */
export async function getErpOverview(orgId: string): Promise<ErpOverview> {
  const since = monthStart();

  const invRows = (await db.execute<{ name: string; min_stock: string; qty: string; val: string }>(sql`
    SELECT COALESCE(i.name_ar, i.code) AS name, i.min_stock,
           COALESCE(s.qty, 0) AS qty, COALESCE(s.val, 0) AS val
    FROM items i
    LEFT JOIN (
      SELECT item_id, SUM(bq) AS qty, SUM(bv) AS val FROM (
        SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity bq, balance_value bv
        FROM stock_movements WHERE organization_id = ${orgId}
        ORDER BY item_id, warehouse_id, created_at DESC, number DESC
      ) t GROUP BY item_id
    ) s ON s.item_id = i.id
    WHERE i.organization_id = ${orgId} AND i.is_active = true
  `)).rows as { name: string; min_stock: string; qty: string; val: string }[];

  const today = new Date();

  const [balances, [sm], [pm], expiry, trend, overdueSales, overduePurch, recentSales, recentPurchases] = await Promise.all([
    accountBalances({ orgId }),
    db.select({ n: sql<number>`count(*)`, t: sql<string>`coalesce(sum(${salesInvoices.totalAmount}),0)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "POSTED"), gte(salesInvoices.date, since))),
    db.select({ n: sql<number>`count(*)`, t: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount}),0)` })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "POSTED"), gte(purchaseInvoices.date, since))),
    getExpiryReport(orgId, {}),
    pnlTrend(orgId),
    db.select({ total: sql<string>`coalesce(sum(${salesInvoices.balanceDue}),0)` })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "POSTED"), lt(salesInvoices.dueDate, today))),
    db.select({ total: sql<string>`coalesce(sum(${purchaseInvoices.balanceDue}),0)` })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "POSTED"), lt(purchaseInvoices.dueDate, today))),
    db.select({ number: salesInvoices.number, amount: salesInvoices.totalAmount, date: salesInvoices.date, customer: customers.nameAr })
      .from(salesInvoices)
      .leftJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(eq(salesInvoices.organizationId, orgId), eq(salesInvoices.status, "POSTED")))
      .orderBy(sql`${salesInvoices.date} desc`)
      .limit(5),
    db.select({ number: purchaseInvoices.number, amount: purchaseInvoices.totalAmount, date: purchaseInvoices.date, supplier: suppliers.nameAr })
      .from(purchaseInvoices)
      .leftJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
      .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "POSTED")))
      .orderBy(sql`${purchaseInvoices.date} desc`)
      .limit(5),
  ]);

  const income = balances.filter((b) => b.type === "REVENUE").reduce((s, b) => s + naturalAmount(b), 0);
  const expense = balances.filter((b) => b.type === "EXPENSE").reduce((s, b) => s + naturalAmount(b), 0);
  const byCode = Object.fromEntries(balances.map((b) => [b.code, b.balance]));

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
    cash: (byCode["1101"] ?? 0) + (byCode["1102"] ?? 0),
    ar: byCode["1103"] ?? 0,
    ap: -(byCode["2101"] ?? 0),
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
}
