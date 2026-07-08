import { and, eq, gt } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers } from "@/db/schema";
import { buildAging, type OpenDoc } from "@/lib/erp/aging";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

/** Excel export of the AP aging report (same as-of date as the page). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const asOf = new URL(req.url).searchParams.get("asOf") || new Date().toISOString().slice(0, 10);

  const docs = await db
    .select({
      partyId: suppliers.id, partyCode: suppliers.code, partyName: suppliers.nameAr,
      date: purchaseInvoices.date, dueDate: purchaseInvoices.dueDate, balanceDue: purchaseInvoices.balanceDue,
    })
    .from(purchaseInvoices)
    .innerJoin(suppliers, eq(suppliers.id, purchaseInvoices.supplierId))
    .where(and(eq(purchaseInvoices.organizationId, orgId), eq(purchaseInvoices.status, "POSTED"), gt(purchaseInvoices.balanceDue, "0")));

  const open: OpenDoc[] = docs.map((d) => ({ ...d, balanceDue: Number(d.balanceDue) }));
  const { rows, totals, grand } = buildAging(open, new Date(`${asOf}T23:59:59`));

  return xlsxResponse({
    sheet: "أعمار ذمم الموردين",
    filename: `ap-aging-${asOf}`,
    headers: ["الكود", "المورد", "جاري", "1-30 يوم", "31-60", "61-90", "أكثر من 90", "الإجمالي"],
    rows: rows.map((r) => [r.partyCode, r.partyName, r.buckets.current, r.buckets.d30, r.buckets.d60, r.buckets.d90, r.buckets.d90plus, r.total]),
    totalRow: ["", "الإجمالي", totals.current, totals.d30, totals.d60, totals.d90, totals.d90plus, grand],
    colWidths: [14, 26, 14, 14, 14, 14, 14, 16],
  });
}
