import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { orgFiscalYearStartISO } from "@/lib/erp/fiscal";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items } from "@/db/schema";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const POSTED = ["POSTED", "PARTIAL_PAID", "PAID"];

/** Excel export of sales by item for the period (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("sales.view");
  const p = new URL(req.url).searchParams;
  const now = new Date();
  const from = p.get("from") || (await orgFiscalYearStartISO(orgId, now));
  const to = p.get("to") || now.toISOString().slice(0, 10);

  return withOrgScope(orgId, false, async () => {
  const rows = await db
    .select({
      code: items.code, name: items.nameAr,
      totalQty: sql<string>`sum(${salesInvoiceLines.quantity})`,
      totalRevenue: sql<string>`sum(${salesInvoiceLines.totalAmount})`,
      totalTax: sql<string>`sum(${salesInvoiceLines.taxAmount})`,
      avgPrice: sql<string>`avg(${salesInvoiceLines.unitPrice})`,
      txnCount: sql<string>`count(distinct ${salesInvoices.id})`,
    })
    .from(salesInvoiceLines)
    .innerJoin(salesInvoices, eq(salesInvoices.id, salesInvoiceLines.salesInvoiceId))
    .innerJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .where(and(eq(salesInvoices.organizationId, orgId), inArray(salesInvoices.status, POSTED), gte(salesInvoices.date, new Date(from)), lte(salesInvoices.date, new Date(to + "T23:59:59"))))
    .groupBy(items.id, items.code, items.nameAr)
    .orderBy(desc(sql`sum(${salesInvoiceLines.totalAmount})`));

  const num = (v: string | null) => Number(v ?? 0);
  const tRev = rows.reduce((s, r) => s + num(r.totalRevenue), 0);
  const tQty = rows.reduce((s, r) => s + num(r.totalQty), 0);

  return xlsxResponse({
    sheet: "أصناف المبيعات",
    filename: `sales-items-${from}_${to}`,
    headers: ["الكود", "الصنف", "الكمية", "الإجمالي", "الضريبة", "متوسط السعر", "عدد الفواتير"],
    rows: rows.map((r) => [r.code, r.name, num(r.totalQty), num(r.totalRevenue), num(r.totalTax), Number(num(r.avgPrice).toFixed(2)), num(r.txnCount)]),
    totalRow: ["", "الإجمالي", tQty, tRev, "", "", ""],
    colWidths: [12, 28, 12, 16, 14, 14, 12],
  });
  });
}
