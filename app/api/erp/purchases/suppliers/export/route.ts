import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];
const iso = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : "");

/** Excel export of the supplier ranking for the period (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
  const to = p.get("to") || now.toISOString().slice(0, 10);

  return withOrgScope(orgId, false, async () => {
  const rows = await db.select({
    code: suppliers.code, name: suppliers.nameAr, balance: suppliers.balance,
    invoices: sql<number>`count(${purchaseInvoices.id})`,
    spend: sql<string>`coalesce(sum(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount}), 0)`,
    last: sql<string>`max(${purchaseInvoices.date})`,
  })
    .from(suppliers)
    .innerJoin(purchaseInvoices, and(eq(purchaseInvoices.supplierId, suppliers.id), inArray(purchaseInvoices.status, POSTED), gte(purchaseInvoices.date, new Date(from)), lte(purchaseInvoices.date, new Date(to + "T23:59:59"))))
    .where(eq(suppliers.organizationId, orgId))
    .groupBy(suppliers.id, suppliers.code, suppliers.nameAr, suppliers.balance);

  const list = rows.map((r) => ({ code: r.code, name: r.name, balance: Number(r.balance ?? 0), invoices: Number(r.invoices), spend: Number(r.spend), last: r.last }))
    .sort((a, b) => b.spend - a.spend);
  const tSpend = list.reduce((s, r) => s + r.spend, 0);
  const tAp = list.reduce((s, r) => s + r.balance, 0);

  return xlsxResponse({
    sheet: "ترتيب الموردين",
    filename: `suppliers-${from}_${to}`,
    headers: ["الكود", "المورد", "المشتريات", "الفواتير", "الرصيد المستحق", "آخر فاتورة"],
    rows: list.map((r) => [r.code, r.name, r.spend, r.invoices, r.balance, iso(r.last)]),
    totalRow: ["", "الإجمالي", tSpend, "", tAp, ""],
    colWidths: [12, 28, 16, 10, 16, 14],
  });
  });
}
