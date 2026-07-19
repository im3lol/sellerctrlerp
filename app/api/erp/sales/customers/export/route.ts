import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];
const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");

/** Excel export of the customer ranking for the period (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("sales.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || `${now.getFullYear()}-01-01`;
  const to = p.get("to") || now.toISOString().slice(0, 10);

  return withOrgScope(orgId, false, async () => {
  const rows = await db.select({
    code: customers.code, name: customers.nameAr, balance: customers.balance,
    invoices: sql<number>`count(${salesInvoices.id})`,
    revenue: sql<string>`coalesce(sum(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount}), 0)`,
    last: sql<string>`max(${salesInvoices.date})`,
  })
    .from(customers)
    .innerJoin(salesInvoices, and(eq(salesInvoices.customerId, customers.id), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, new Date(from)), lte(salesInvoices.date, new Date(to + "T23:59:59"))))
    .where(eq(customers.organizationId, orgId))
    .groupBy(customers.id, customers.code, customers.nameAr, customers.balance);

  const list = rows.map((r) => ({ code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), revenue: Number(r.revenue), last: r.last }))
    .sort((a, b) => b.revenue - a.revenue);
  const tRev = list.reduce((s, r) => s + r.revenue, 0);
  const tAr = list.reduce((s, r) => s + r.balance, 0);

  return xlsxResponse({
    sheet: "ترتيب العملاء",
    filename: `customers-${from}_${to}`,
    headers: ["الكود", "العميل", "الإيراد", "الفواتير", "الرصيد المستحق", "آخر فاتورة"],
    rows: list.map((r) => [r.code, r.name, r.revenue, r.invoices, r.balance, iso(r.last)]),
    totalRow: ["", "الإجمالي", tRev, "", tAr, ""],
    colWidths: [12, 28, 16, 10, 16, 14],
  });
  });
}
