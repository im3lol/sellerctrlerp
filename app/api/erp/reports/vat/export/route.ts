import { withOrgScope } from "@/lib/db-scope";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, purchaseInvoices } from "@/db/schema";
import { liveInvoice } from "@/lib/erp/invoice-status";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the VAT return for the page's period. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("reports.view");
  return withOrgScope(orgId, false, async () => {
    const p = new URL(req.url).searchParams;
    const now = new Date();
    const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
    const okDate = (s: string | null, fb: Date) => { if (!s) return fb; const d = new Date(s); return Number.isNaN(d.getTime()) ? fb : d; };
    const fromDate = okDate(p.get("from"), qStart);
    const toDate = okDate(p.get("to"), qEnd);

    const sales = await db
      .select({ number: salesInvoices.number, date: salesInvoices.date, party: sql<string>`(SELECT name_ar FROM customers WHERE id = ${salesInvoices.customerId})`, net: sql<string>`(${salesInvoices.totalAmount} - ${salesInvoices.taxAmount})`, tax: salesInvoices.taxAmount, pct: salesInvoices.taxPercent })
      .from(salesInvoices)
      .where(and(eq(salesInvoices.organizationId, orgId), liveInvoice(salesInvoices.status), gte(salesInvoices.date, fromDate), lte(salesInvoices.date, toDate), ne(salesInvoices.taxAmount, "0")))
      .orderBy(salesInvoices.date, salesInvoices.number);

    const purchases = await db
      .select({ number: purchaseInvoices.number, date: purchaseInvoices.date, party: sql<string>`(SELECT name_ar FROM suppliers WHERE id = ${purchaseInvoices.supplierId})`, net: sql<string>`(${purchaseInvoices.totalAmount} - ${purchaseInvoices.taxAmount} - COALESCE(${purchaseInvoices.shippingAmount}, 0))`, tax: purchaseInvoices.taxAmount, pct: purchaseInvoices.taxPercent })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.organizationId, orgId), liveInvoice(purchaseInvoices.status), gte(purchaseInvoices.date, fromDate), lte(purchaseInvoices.date, toDate), ne(purchaseInvoices.taxAmount, "0")))
      .orderBy(purchaseInvoices.date, purchaseInvoices.number);

    const outVat = sales.reduce((s, r) => s + Number(r.tax), 0);
    const inVat = purchases.reduce((s, r) => s + Number(r.tax), 0);

    const rows: (string | number)[][] = [];
    sales.forEach((r) => rows.push(["مخرجات (بيع)", r.number, xlsxDate(r.date), r.party ?? "—", Number(r.net), `${Number(r.pct)}%`, Number(r.tax)]));
    rows.push(["", "", "", "إجمالي الضريبة المحصّلة", "", "", outVat]);
    purchases.forEach((r) => rows.push(["مدخلات (شراء)", r.number, xlsxDate(r.date), r.party ?? "—", Number(r.net), `${Number(r.pct)}%`, Number(r.tax)]));
    rows.push(["", "", "", "إجمالي الضريبة المدفوعة", "", "", inVat]);

    return xlsxResponse({
      sheet: "إقرار ضريبة القيمة المضافة",
      filename: `vat-${xlsxDate(fromDate)}_${xlsxDate(toDate)}`,
      headers: ["النوع", "الرقم", "التاريخ", "الطرف", "الأساس", "النسبة", "الضريبة"],
      rows,
      totalRow: ["", "", "", "صافي الضريبة المستحقة / (المستردّة)", "", "", outVat - inVat],
      colWidths: [16, 16, 12, 24, 14, 10, 14],
    });
  });
}
