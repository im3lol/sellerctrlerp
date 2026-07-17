import { withOrgScope } from "@/lib/db-scope";
import { and, eq, gt } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, customers } from "@/db/schema";
import { buildAging, openForAging, type OpenDoc } from "@/lib/erp/aging";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the AR aging report (same as-of date as the page). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("sales.view");
  return withOrgScope(orgId, false, async () => {
    const asOf = new URL(req.url).searchParams.get("asOf") || new Date().toISOString().slice(0, 10);

    const docs = await db
      .select({
        partyId: customers.id, partyCode: customers.code, partyName: customers.nameAr,
        date: salesInvoices.date, dueDate: salesInvoices.dueDate, balanceDue: salesInvoices.balanceDue,
      })
      .from(salesInvoices)
      .innerJoin(customers, eq(customers.id, salesInvoices.customerId))
      .where(and(eq(salesInvoices.organizationId, orgId), openForAging(salesInvoices.status), gt(salesInvoices.balanceDue, "0")));

    const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
    const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

    return xlsxResponse({
      sheet: "أعمار ذمم العملاء",
      filename: `ar-aging-${asOf}`,
      headers: ["الكود", "العميل", "جاري", "1-30 يوم", "31-60", "61-90", "أكثر من 90", "الإجمالي"],
      rows: rows.map((r) => [r.partyCode, r.partyName, r.buckets.current, r.buckets.d30, r.buckets.d60, r.buckets.d90, r.buckets.d90plus, r.total]),
      totalRow: ["", "الإجمالي", totals.current, totals.d30, totals.d60, totals.d90, totals.d90plus, grand],
      colWidths: [14, 26, 14, 14, 14, 14, 14, 16],
    });
  });
}
