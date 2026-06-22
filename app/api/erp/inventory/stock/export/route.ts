import * as XLSX from "xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { getStockBalances } from "@/lib/erp/stock-balances";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = { OK: "متوفّر", LOW: "منخفض", OUT: "نافد" };

const today = () => {
  const x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

/** Excel export of stock balances, honouring the page filters. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("inventory.view");
  const url = new URL(req.url);
  const { lines, totals } = await getStockBalances(orgId, {
    product: url.searchParams.get("product") ?? "",
    warehouse: url.searchParams.get("warehouse") ?? "",
    status: url.searchParams.get("status") ?? "",
  });

  const expFmt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const headers = ["الكود", "الصنف", "المستودع", "الكمية", "متوسط التكلفة", "القيمة", "أقرب انتهاء", "الحالة"];
  const body = lines.map((l) => [l.code, l.name, l.warehouse, l.quantity, l.avgCost, l.value, expFmt(l.nearestExpiry), STATUS_LABEL[l.status] ?? l.status]);
  const totalRow = ["الإجمالي", "", "", totals.quantity, "", totals.value, "", ""];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...body, totalRow]);
  ws["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "أرصدة المخزون");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="stock-balances-${today()}.xlsx"`,
    },
  });
}
