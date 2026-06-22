import * as XLSX from "xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { getPurchasesLedger, type LedgerDocType } from "@/lib/erp/purchases-ledger";

export const runtime = "nodejs";

const DOC_LABEL: Record<LedgerDocType, string> = {
  ORDER: "أمر شراء",
  RECEIPT: "إذن استلام",
  INVOICE: "فاتورة شراء",
  RETURN: "مرتجع",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", RECEIVED: "مُستلم", PARTIALLY_RECEIVED: "مُستلم جزئياً",
  INVOICED: "مُفوتر", POSTED: "مُرحَّل", PARTIAL_PAID: "مدفوعة جزئياً",
  PAID: "مدفوعة", CANCELLED: "ملغاة",
};

const fmtDate = (d: Date) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
};

/** Excel export of the purchases ledger, honouring the same filters as the page. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const url = new URL(req.url);
  const { rows, totals } = await getPurchasesLedger(orgId, {
    supplier: url.searchParams.get("supplier") ?? "",
    type: url.searchParams.get("type") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });

  const headers = [
    "الرقم", "التاريخ", "المورد", "النوع", "الحالة",
    "الكلي", "المستلم", "المرفوض",
    "السعر", "الشحن", "الخصم", "الضريبة", "الإجمالي",
  ];

  // Raw numbers (not formatted strings) so Excel can sum/filter; "" for N/A cells.
  const body = rows.map((r) => [
    r.number,
    fmtDate(r.date),
    r.supplierName,
    DOC_LABEL[r.docType],
    STATUS_LABEL[r.status] ?? r.status,
    r.qtyTotal ?? "",
    r.qtyReceived ?? "",
    r.qtyRejected ?? "",
    r.subtotal ?? "",
    r.shipping ?? "",
    r.discount ?? "",
    r.tax ?? "",
    r.total ?? "",
  ]);

  const totalRow = [
    "الإجمالي الكلي", "", "", "", "",
    totals.qtyTotal, totals.qtyReceived, totals.qtyRejected,
    totals.subtotal, totals.shipping, totals.discount, totals.tax, totals.total,
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...body, totalRow]);
  ws["!cols"] = [
    { wch: 16 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 14 },
    { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "دفتر المشتريات");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="purchases-ledger-${fmtDate(new Date())}.xlsx"`,
    },
  });
}
