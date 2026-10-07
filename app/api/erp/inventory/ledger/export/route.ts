import { xlsxBuild } from "@/lib/erp/xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { getStockLedger, MOVE_TYPE, MOVE_REF } from "@/lib/erp/stock-ledger";

export const runtime = "nodejs";

const fmtDate = (d: Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Excel export of the per-item stock ledger, honouring the page filters. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const url = new URL(req.url);
  const itemId = url.searchParams.get("item") ?? "";
  const { rows, totals } = await withOrgScope(orgId, false, () => getStockLedger(orgId, {
    itemId,
    warehouse: url.searchParams.get("warehouse") ?? "",
    type: url.searchParams.get("type") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  }));

  const headers = ["التاريخ", "الصنف", "الحركة", "المستند", "المستودع", "وارد", "منصرف", "التكلفة", "رصيد الكمية", "قيمة الرصيد"];
  const body = rows.map((r) => {
    const isOut = r.type === "OUT";
    return [
      fmtDate(r.date),
      [r.itemCode, r.itemName].filter(Boolean).join(" — "),
      MOVE_TYPE[r.type]?.label ?? r.type,
      MOVE_REF[r.refType ?? ""] ?? r.reason ?? "—",
      r.warehouse ?? "—",
      isOut ? "" : r.quantity,
      isOut ? r.quantity : "",
      r.unitCost,
      r.balanceQuantity,
      r.balanceValue,
    ];
  });
  const totalRow = ["الإجمالي", "", "", "", "", totals.inQty, totals.outQty, "", "", ""];

  return xlsxBuild([headers, ...body, totalRow], "حركة المخزون", "stock-ledger", [12, 26, 10, 18, 18, 12, 12, 12, 14, 14]);
}
