import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { getExpiryReport } from "@/lib/erp/expiry";
import { xlsxResponse } from "@/lib/erp/xlsx";

export const runtime = "nodejs";
const STATUS_AR: Record<string, string> = { EXPIRED: "منتهية", NEAR: "قريبة", OK: "سليمة" };
const iso = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Excel export of expiring/expired batches (real DB data). */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const p = new URL(req.url).searchParams;
  const within = Number(p.get("within")) || 30;

  return withOrgScope(orgId, false, async () => {
  const { rows } = await getExpiryReport(orgId, {
    product: p.get("product") ?? "", warehouse: p.get("warehouse") ?? "", status: p.get("status") ?? "", withinDays: within,
  });

  return xlsxResponse({
    sheet: "انتهاء الصلاحية",
    filename: "expiry",
    headers: ["الكود", "الصنف", "المستودع", "رقم الدفعة", "تاريخ الانتهاء", "الأيام المتبقية", "الكمية", "القيمة", "الحالة"],
    rows: rows.map((r) => [r.itemCode, r.itemName, r.warehouse, r.batchNo ?? "—", iso(r.expiryDate), r.daysLeft, r.remaining, r.value, STATUS_AR[r.status] ?? r.status]),
    colWidths: [12, 26, 18, 14, 14, 12, 10, 14, 10],
  });
  });
}
