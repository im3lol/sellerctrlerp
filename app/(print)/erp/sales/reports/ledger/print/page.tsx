import { loadErpPage } from "@/lib/erp/org";
import { getSalesLedger } from "@/lib/erp/sales-ledger";
import { fmt, qty, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// ponytail: DOC/STATUS labels mirrored from components/erp/sales-ledger-table.tsx
// (that file is "use client" — its consts can't be imported into a server page).
const DOC_LABELS: Record<string, string> = {
  ORDER: "أمر بيع", DELIVERY: "إذن صرف", INVOICE: "فاتورة بيع", RETURN: "مرتجع",
};
const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", DELIVERED: "مُسلّم", PARTIALLY_DELIVERED: "مُسلّم جزئياً",
  INVOICED: "مُفوتر", POSTED: "مُرحَّل", PARTIAL_PAID: "مدفوعة جزئياً",
  PAID: "مدفوعة", CANCELLED: "ملغاة",
};

const MAX_ROWS = 3000;
const cell = (v: number | null, f: (n: number) => string) => (v !== null ? f(v) : "—");

export default async function PrintSalesLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("sales.view", async ({ orgId }) => {
    const sp = await searchParams;
    const fCustomer = one(sp.customer).trim();
    const fType = one(sp.type);
    const from = one(sp.from);
    const to = one(sp.to);
    const fProduct = one(sp.product).trim();

    const [{ org }, { rows, totals }] = await Promise.all([
      loadPrintHeader(orgId),
      getSalesLedger(orgId, { customer: fCustomer, type: fType, from, to, product: fProduct }),
    ]);

    const shown = rows.slice(0, MAX_ROWS);

    const qs = new URLSearchParams();
    if (fCustomer) qs.set("customer", fCustomer);
    if (fType) qs.set("type", fType);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (fProduct) qs.set("product", fProduct);

    const period = from || to
      ? `من ${from ? dt(from) : "البداية"} إلى ${to ? dt(to) : "اليوم"}`
      : undefined;

    return (
      <ReportSheet
        org={org}
        title="تقرير دفتر المبيعات"
        period={period}
        filters={[
          ...(fCustomer ? [{ label: "العميل", value: fCustomer }] : []),
          ...(fProduct ? [{ label: "المنتج", value: fProduct }] : []),
          ...(fType ? [{ label: "نوع الوثيقة", value: DOC_LABELS[fType] ?? fType }] : []),
        ]}
        kpis={[{ label: "عدد الحركات", value: String(rows.length) }]}
        sections={[{
          title: "دفتر المبيعات",
          columns: [
            { label: "الرقم", width: "11%" },
            { label: "التاريخ", width: "10%" },
            { label: "العميل", width: "17%" },
            { label: "النوع", width: "9%" },
            { label: "الحالة", width: "9%" },
            { label: "الكلي", align: "end", width: "7%" },
            { label: "المُسلّم", align: "end", width: "7%" },
            { label: "السعر", align: "end", width: "8%" },
            { label: "الخصم", align: "end", width: "7%" },
            { label: "الضريبة", align: "end", width: "7%" },
            { label: "الإجمالي", align: "end", width: "8%" },
          ],
          rows: shown.map((r) => [
            <span key="num" dir="ltr" style={{ fontSize: 10 }}>{r.number}</span>,
            dt(r.date),
            r.customerName,
            DOC_LABELS[r.docType],
            STATUS[r.status] ?? r.status,
            cell(r.qtyTotal, qty),
            cell(r.qtyDelivered, qty),
            cell(r.subtotal, fmt),
            cell(r.discount, fmt),
            cell(r.tax, fmt),
            <b key="t">{cell(r.total, fmt)}</b>,
          ]),
          footerRow: [
            "الإجمالي الكلي", "", "", "", "",
            qty(totals.qtyTotal), qty(totals.qtyDelivered),
            fmt(totals.subtotal), fmt(totals.discount), fmt(totals.tax), fmt(totals.total),
          ],
        }]}
        note={
          rows.length === 0
            ? "لا توجد حركات مبيعات مطابقة."
            : rows.length > MAX_ROWS
              ? `عُرضت أول ${MAX_ROWS} صف من ${rows.length} — الإجماليات تشمل كل الحركات.`
              : null
        }
        backHref={`/sales/reports/ledger${qs.toString() ? `?${qs.toString()}` : ""}`}
      />
    );
  });
}
