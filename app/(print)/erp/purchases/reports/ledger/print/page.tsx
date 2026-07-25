import { loadErpPage } from "@/lib/erp/org";
import { getPurchasesLedger } from "@/lib/erp/purchases-ledger";
import { fmt, qty, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { ReportSheet } from "@/components/erp/print/report-sheet";

const MAX_ROWS = 3000;

const DOC_LABEL: Record<string, string> = {
  ORDER: "أمر شراء", RECEIPT: "إذن استلام", INVOICE: "فاتورة شراء", RETURN: "مرتجع",
};
const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", RECEIVED: "مُستلم", PARTIALLY_RECEIVED: "مُستلم جزئياً",
  INVOICED: "مُفوتر", POSTED: "مُرحَّل", PARTIAL_PAID: "مدفوعة جزئياً",
  PAID: "مدفوعة", CANCELLED: "ملغاة",
};

const d2 = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });
const q = (v: number | null) => (v !== null ? qty(v) : "—");
const m = (v: number | null) => (v !== null ? fmt(v) : "—");

type SP = { [k: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PrintPurchasesLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const sp = await searchParams;
    const fSupplier = one(sp.supplier);
    const fType = one(sp.type);
    const from = one(sp.from);
    const to = one(sp.to);
    const fProduct = one(sp.product).trim();

    const [{ org }, { rows, totals }] = await Promise.all([
      loadPrintHeader(orgId),
      getPurchasesLedger(orgId, { supplier: fSupplier, type: fType, from, to, product: fProduct }),
    ]);
    const shown = rows.slice(0, MAX_ROWS);

    const backQs = new URLSearchParams();
    if (fSupplier) backQs.set("supplier", fSupplier);
    if (fType) backQs.set("type", fType);
    if (from) backQs.set("from", from);
    if (to) backQs.set("to", to);
    if (fProduct) backQs.set("product", fProduct);

    return (
      <ReportSheet
        org={org}
        title="تقرير دفتر المشتريات"
        period={from || to ? `من ${from ? dt(from) : "البداية"} إلى ${to ? dt(to) : "اليوم"}` : undefined}
        filters={[
          ...(fSupplier ? [{ label: "المورد", value: fSupplier }] : []),
          ...(fType ? [{ label: "نوع الوثيقة", value: DOC_LABEL[fType] ?? fType }] : []),
          ...(fProduct ? [{ label: "المنتج", value: fProduct }] : []),
        ]}
        kpis={[{ label: "عدد الحركات", value: String(rows.length) }]}
        sections={[{
          columns: [
            { label: "الرقم", width: "9%" },
            { label: "التاريخ", width: "8%" },
            { label: "المورد", width: "14%" },
            { label: "النوع", width: "8%" },
            { label: "الحالة", width: "8%" },
            { label: "الكلي", align: "end", width: "6%" },
            { label: "المستلم", align: "end", width: "6%" },
            { label: "المرفوض", align: "end", width: "6%" },
            { label: "السعر", align: "end", width: "8%" },
            { label: "الشحن", align: "end", width: "6%" },
            { label: "الخصم", align: "end", width: "6%" },
            { label: "الضريبة", align: "end", width: "6%" },
            { label: "الإجمالي", align: "end", width: "9%" },
          ],
          rows: shown.map((r) => [
            <span key="n" dir="ltr" style={{ fontSize: 9.5 }}>{r.number}</span>,
            d2(r.date),
            r.supplierName,
            DOC_LABEL[r.docType],
            STATUS[r.status] ?? r.status,
            q(r.qtyTotal),
            q(r.qtyReceived),
            q(r.qtyRejected),
            m(r.subtotal),
            m(r.shipping),
            m(r.discount),
            m(r.tax),
            <b key="t">{m(r.total)}</b>,
          ]),
          footerRow: [
            "الإجمالي الكلي", "", "", "", "",
            qty(totals.qtyTotal), qty(totals.qtyReceived), qty(totals.qtyRejected),
            fmt(totals.subtotal), fmt(totals.shipping), fmt(totals.discount), fmt(totals.tax), fmt(totals.total),
          ],
        }]}
        note={rows.length > MAX_ROWS ? `عُرضت أول ${MAX_ROWS} صف من ${rows.length} — ضيّق الفلاتر أو استخدم تصدير Excel للحصر الكامل.` : null}
        backHref={`/purchases/reports/ledger${backQs.size ? `?${backQs}` : ""}`}
      />
    );
  });
}
