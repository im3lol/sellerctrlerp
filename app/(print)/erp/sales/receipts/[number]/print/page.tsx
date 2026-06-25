import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { receiptVouchers, receiptLines, customers, salesInvoices, organizations } from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

const METHODS: Record<string, string> = {
  CASH: "نقدًا", BANK_TRANSFER: "تحويل بنكي", CHECK: "شيك", CREDIT_CARD: "بطاقة ائتمان",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintReceiptVoucherPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.view");

  const [rv] = await db
    .select()
    .from(receiptVouchers)
    .where(and(eq(receiptVouchers.number, raw), eq(receiptVouchers.organizationId, orgId)))
    .limit(1);
  if (!rv) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  const [cust] = rv.customerId
    ? await db
        .select({ nameAr: customers.nameAr, phone: customers.phone })
        .from(customers)
        .where(eq(customers.id, rv.customerId))
        .limit(1)
    : [undefined];

  const lines = await db
    .select({ amount: receiptLines.amount, invoiceNumber: salesInvoices.number })
    .from(receiptLines)
    .leftJoin(salesInvoices, eq(salesInvoices.id, receiptLines.salesInvoiceId))
    .where(eq(receiptLines.receiptVoucherId, rv.id));

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif; font-size: 13px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
        thead { background: #f9fafb; }
      `}</style>

      <div className="no-print fixed top-4 start-4 z-50 flex gap-2">
        <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow">طباعة</button>
        <a href={`/erp/sales/receipts/${encodeURIComponent(raw)}`} className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted">رجوع</a>
      </div>

      <div className="mx-auto max-w-[700px] p-8 print:p-0">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between border-b-2 pb-6">
          <div>
            <h1 className="text-xl font-bold">{org?.nameAr}</h1>
            {org?.address && <p className="text-sm text-gray-600">{org.address}</p>}
            {org?.phone   && <p className="text-sm text-gray-600">هاتف: {org.phone}</p>}
          </div>
          <div className="text-end">
            <p className="font-bold text-gray-600">سند قبض</p>
            <p className="mt-1 text-2xl font-mono font-bold text-emerald-700">{rv.number}</p>
            <p className="text-sm text-gray-500">{dt(rv.date)}</p>
          </div>
        </div>

        {/* Amount box */}
        <div className="mb-6 rounded-xl bg-emerald-50 p-5 text-center border border-emerald-200">
          <p className="text-sm text-emerald-700">المبلغ المستلم</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-800">{fmt(rv.amount)} ﷼</p>
        </div>

        {/* Details */}
        <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-gray-500">استُلم من</p>
            <p className="mt-1 font-semibold">{cust?.nameAr ?? "—"}</p>
            {cust?.phone && <p className="text-gray-600">{cust.phone}</p>}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-gray-500">طريقة السداد</p>
            <p className="mt-1 font-semibold">{METHODS[rv.paymentMethod] ?? rv.paymentMethod}</p>
            {rv.reference && <p className="text-gray-600">المرجع: {rv.reference}</p>}
          </div>
        </div>

        {/* Invoice lines */}
        {lines.length > 0 && (
          <table className="mb-6 text-sm">
            <thead>
              <tr>
                <th className="text-start">رقم الفاتورة</th>
                <th className="text-end">المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="font-mono">{l.invoiceNumber ?? "—"}</td>
                  <td className="text-end tabular-nums">{fmt(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {rv.notes && (
          <div className="mt-4 rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p>{rv.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-3 gap-8 text-sm text-gray-500">
          {["التوقيع", "المستلم", "المحاسب"].map((label) => (
            <div key={label} className="text-center">
              <div className="mb-2 h-10 border-b border-gray-300" />
              <p>{label}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
