import { xlsxBuild } from "@/lib/erp/xlsx";
import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
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
  const { rows, totals } = await withOrgScope(orgId, false, () => getPurchasesLedger(orgId, {
    supplier: url.searchParams.get("supplier") ?? "",
    type: url.searchParams.get("type") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    product: url.searchParams.get("product") ?? "",
  }));

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

  return xlsxBuild([headers, ...body, totalRow], "دفتر المشتريات", "purchases-ledger", [16, 12, 24, 12, 14, 10, 10, 10, 12, 12, 12, 12, 14]);
}
