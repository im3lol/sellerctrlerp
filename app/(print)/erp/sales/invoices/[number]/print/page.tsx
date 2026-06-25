import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import {
  salesInvoices, salesInvoiceLines, customers, items, organizations,
} from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

type Params = { params: Promise<{ number: string }> };

export default async function PrintSalesInvoicePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.view");

  const [inv] = await db
    .select()
    .from(salesInvoices)
    .where(and(eq(salesInvoices.number, raw), eq(salesInvoices.organizationId, orgId)))
    .limit(1);
  if (!inv) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  const [cust] = inv.customerId
    ? await db
        .select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
        .from(customers)
        .where(eq(customers.id, inv.customerId))
        .limit(1)
    : [undefined];

  const lines = await db
    .select({
      qty: salesInvoiceLines.quantity,
      unitPrice: salesInvoiceLines.unitPrice,
      discount: salesInvoiceLines.discountAmount,
      tax: salesInvoiceLines.taxAmount,
      total: salesInvoiceLines.totalAmount,
      code: items.code,
      name: items.nameAr,
    })
    .from(salesInvoiceLines)
    .leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .where(eq(salesInvoiceLines.salesInvoiceId, inv.id));

  const subtotal  = Number(inv.totalAmount) - Number(inv.taxAmount ?? 0);
  const taxAmount = Number(inv.taxAmount ?? 0);
  const total     = Number(inv.totalAmount);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } body { font-size: 12px; } }
        body { font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
        thead { background: #f9fafb; }
        .text-end { text-align: end; }
        .text-center { text-align: center; }
        tfoot td { background: #f9fafb; font-weight: 600; }
      `}</style>

      {/* Print button */}
      <div className="no-print fixed top-4 start-4 z-50 flex gap-2">
        <button
          onClick={() => window.print()}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          طباعة
        </button>
        <a
          href={`/erp/sales/invoices/${encodeURIComponent(raw)}`}
          className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted"
        >
          رجوع
        </a>
      </div>

      <div className="mx-auto max-w-[800px] p-8 print:p-0">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between border-b pb-6">
          <div>
            <h1 className="text-2xl font-bold">{org?.nameAr}</h1>
            {org?.address  && <p className="mt-0.5 text-sm text-gray-600">{org.address}</p>}
            {org?.phone    && <p className="text-sm text-gray-600">هاتف: {org.phone}</p>}
            {org?.taxNumber && <p className="text-sm text-gray-600">الرقم الضريبي: {org.taxNumber}</p>}
          </div>
          <div className="text-end">
            <p className="text-lg font-bold text-gray-700">فاتورة بيع</p>
            <p className="mt-1 text-2xl font-mono font-bold text-primary">{inv.number}</p>
            <p className="mt-1 text-sm text-gray-500">التاريخ: {dt(inv.date)}</p>
            {inv.dueDate && <p className="text-sm text-gray-500">الاستحقاق: {dt(inv.dueDate)}</p>}
          </div>
        </div>

        {/* Customer info */}
        {cust && (
          <div className="mb-6 rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">فُتِحت باسم</p>
            <p className="mt-1 text-base font-semibold">{cust.nameAr}</p>
            {cust.phone   && <p className="text-sm text-gray-600">هاتف: {cust.phone}</p>}
            {cust.address && <p className="text-sm text-gray-600">{cust.address}</p>}
          </div>
        )}

        {/* Lines */}
        <table className="mb-6 text-sm">
          <thead>
            <tr>
              <th className="text-start">#</th>
              <th className="text-start">الصنف</th>
              <th className="text-center">الكمية</th>
              <th className="text-end">سعر الوحدة</th>
              <th className="text-end">الخصم</th>
              <th className="text-end">الضريبة</th>
              <th className="text-end">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="text-gray-500">{i + 1}</td>
                <td>
                  <span className="text-xs text-gray-400 font-mono">{l.code}</span>{" "}
                  {l.name}
                </td>
                <td className="text-center tabular-nums">{qty(l.qty)}</td>
                <td className="text-end tabular-nums">{fmt(l.unitPrice)}</td>
                <td className="text-end tabular-nums">{Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—"}</td>
                <td className="text-end tabular-nums">{Number(l.tax ?? 0) > 0 ? fmt(l.tax) : "—"}</td>
                <td className="text-end tabular-nums font-medium">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6} className="text-end">صافي المبلغ</td>
              <td className="text-end tabular-nums">{fmt(subtotal)}</td>
            </tr>
            {taxAmount > 0 && (
              <tr>
                <td colSpan={6} className="text-end">ضريبة القيمة المضافة ({inv.taxPercent}%)</td>
                <td className="text-end tabular-nums">{fmt(taxAmount)}</td>
              </tr>
            )}
            <tr style={{ background: "#dbeafe" }}>
              <td colSpan={6} className="text-end font-bold">الإجمالي الكلي</td>
              <td className="text-end tabular-nums font-bold text-lg">{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Balance */}
        {Number(inv.paidAmount) > 0 && (
          <div className="mb-6 flex justify-end gap-8 text-sm">
            <span className="text-gray-600">المدفوع: <strong className="tabular-nums">{fmt(inv.paidAmount)}</strong></span>
            <span className="text-gray-600">المتبقّي: <strong className="tabular-nums text-red-700">{fmt(inv.balanceDue)}</strong></span>
          </div>
        )}

        {/* Notes */}
        {inv.notes && (
          <div className="mt-4 rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p className="mt-1">{inv.notes}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-10 border-t pt-4 text-center text-xs text-gray-400">
          {org?.nameAr} · {org?.phone ?? ""} · {org?.taxNumber ? `الرقم الضريبي: ${org.taxNumber}` : ""}
        </div>
      </div>
    </>
  );
}
