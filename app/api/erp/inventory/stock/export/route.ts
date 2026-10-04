import { xlsxBuild } from "@/lib/erp/xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { getStockBalances } from "@/lib/erp/stock-balances";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = { OK: "متوفّر", LOW: "منخفض", OUT: "نافد" };


/** Excel export of stock balances, honouring the page filters. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const url = new URL(req.url);
  const { lines, totals } = await withOrgScope(orgId, false, () => getStockBalances(orgId, {
    product: url.searchParams.get("product") ?? "",
    warehouse: url.searchParams.get("warehouse") ?? "",
    status: url.searchParams.get("status") ?? "",
  }));

  const expFmt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const headers = ["الكود", "الصنف", "المستودع", "الكمية", "متوسط التكلفة", "القيمة", "أقرب انتهاء", "الحالة"];
  const body = lines.map((l) => [l.code, l.name, l.warehouse, l.quantity, l.avgCost, l.value, expFmt(l.nearestExpiry), STATUS_LABEL[l.status] ?? l.status]);
  const totalRow = ["الإجمالي", "", "", totals.quantity, "", totals.value, "", ""];

  return xlsxBuild([headers, ...body, totalRow], "أرصدة المخزون", "stock-balances", [16, 28, 18, 12, 14, 14, 12, 10]);
}
