import * as XLSX from "xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { getSalesLedger, type SalesLedgerDocType } from "@/lib/erp/sales-ledger";

export const runtime = "nodejs";

const DOC_LABEL: Record<SalesLedgerDocType, string> = {
  ORDER: "أمر بيع",
  DELIVERY: "إذن صرف",
  INVOICE: "فاتورة بيع",
  RETURN: "مرتجع",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", DELIVERED: "مُسلّم", PARTIALLY_DELIVERED: "مُسلّم جزئياً",
  INVOICED: "مُفوتر", POSTED: "مُرحَّل", PARTIAL_PAID: "مدفوعة جزئياً",
  PAID: "مدفوعة", CANCELLED: "ملغاة",
};

const fmtDate = (d: Date) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
};

/** Excel export of the sales ledger, honouring the same filters as the page. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("sales.view");
  const url = new URL(req.url);
  const { rows, totals } = await getSalesLedger(orgId, {
    customer: url.searchParams.get("customer") ?? "",
    type: url.searchParams.get("type") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    product: url.searchParams.get("product") ?? "",
  });

  const headers = [
    "الرقم", "التاريخ", "العميل", "النوع", "الحالة",
    "الكلي", "المُسلّم",
    "السعر", "الخصم", "الضريبة", "الإجمالي",
  ];

  const body = rows.map((r) => [
    r.number,
    fmtDate(r.date),
    r.customerName,
    DOC_LABEL[r.docType],
    STATUS_LABEL[r.status] ?? r.status,
    r.qtyTotal ?? "",
    r.qtyDelivered ?? "",
    r.subtotal ?? "",
    r.discount ?? "",
    r.tax ?? "",
    r.total ?? "",
  ]);

  const totalRow = [
    "الإجمالي الكلي", "", "", "", "",
    totals.qtyTotal, totals.qtyDelivered,
    totals.subtotal, totals.discount, totals.tax, totals.total,
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...body, totalRow]);
  ws["!cols"] = [
    { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 },
    { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "دفتر المبيعات");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sales-ledger-${fmtDate(new Date())}.xlsx"`,
    },
  });
}
