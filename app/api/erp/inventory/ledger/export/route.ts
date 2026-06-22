import * as XLSX from "xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { getStockLedger, MOVE_TYPE, MOVE_REF } from "@/lib/erp/stock-ledger";

export const runtime = "nodejs";

const today = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d: Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Excel export of the per-item stock ledger, honouring the page filters. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const url = new URL(req.url);
  const itemId = url.searchParams.get("item") ?? "";
  const { rows, totals } = await getStockLedger(orgId, {
    itemId,
    warehouse: url.searchParams.get("warehouse") ?? "",
    type: url.searchParams.get("type") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });

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

  const ws = XLSX.utils.aoa_to_sheet([headers, ...body, totalRow]);
  ws["!cols"] = [{ wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "حركة المخزون");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-ledger-${today()}.xlsx"`,
    },
  });
}
