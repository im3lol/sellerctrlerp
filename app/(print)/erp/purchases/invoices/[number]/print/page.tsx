import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items, organizations } from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

type Params = { params: Promise<{ number: string }> };

export default async function PrintPurchaseInvoicePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.view");

  const [inv] = await db
    .select()
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId)))
    .limit(1);
  if (!inv) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations).where(eq(organizations.id, orgId));

  const [supp] = inv.supplierId
    ? await db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
        .from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1)
    : [undefined];

  const lines = await db
    .select({
      qty: purchaseInvoiceLines.quantity,
      unitPrice: purchaseInvoiceLines.unitPrice,
      shipping: purchaseInvoiceLines.shippingPerUnit,
      discount: purchaseInvoiceLines.discountAmount,
      tax: purchaseInvoiceLines.taxAmount,
      total: purchaseInvoiceLines.totalAmount,
      code: items.code,
      name: items.nameAr,
    })
    .from(purchaseInvoiceLines)
    .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));

  const subtotal  = Number(inv.totalAmount) - Number(inv.taxAmount ?? 0);
  const taxAmount = Number(inv.taxAmount ?? 0);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 16mm; }
        @media print { .no-print { display: none !important; } }
        body { font-family: 'Segoe UI', 'Noto Sans Arabic', sans-serif; font-size: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 6px 10px; border: 1px solid #e5e7eb; }
        thead { background: #f9fafb; }
        tfoot td { background: #f9fafb; font-weight: 600; }
      `}</style>

      <div className="no-print fixed top-4 start-4 z-50 flex gap-2">
        <button onClick={() => window.print()} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow">طباعة</button>
        <a href={`/erp/purchases/invoices/${encodeURIComponent(raw)}`} className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted">رجوع</a>
      </div>

      <div className="mx-auto max-w-[800px] p-8 print:p-0">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between border-b-2 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{org?.nameAr}</h1>
            {org?.address   && <p className="text-sm text-gray-600">{org.address}</p>}
            {org?.phone     && <p className="text-sm text-gray-600">هاتف: {org.phone}</p>}
            {org?.taxNumber && <p className="text-sm text-gray-600">الرقم الضريبي: {org.taxNumber}</p>}
          </div>
          <div className="text-end">
            <p className="text-lg font-bold text-gray-700">فاتورة شراء</p>
            <p className="mt-1 text-2xl font-mono font-bold text-primary">{inv.number}</p>
            <p className="mt-1 text-sm text-gray-500">التاريخ: {dt(inv.date)}</p>
            {inv.dueDate && <p className="text-sm text-gray-500">الاستحقاق: {dt(inv.dueDate)}</p>}
          </div>
        </div>

        {/* Supplier */}
        <div className="mb-6 rounded-lg border bg-gray-50 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">المورّد</p>
          <p className="mt-1 font-semibold">{supp?.nameAr ?? "—"}</p>
          {supp?.phone   && <p className="text-sm text-gray-600">هاتف: {supp.phone}</p>}
          {supp?.address && <p className="text-sm text-gray-600">{supp.address}</p>}
        </div>

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
                <td><span className="font-mono text-xs text-gray-400">{l.code}</span> {l.name}</td>
                <td className="text-center tabular-nums">{qty(l.qty)}</td>
                <td className="text-end tabular-nums">{fmt(l.unitPrice)}</td>
                <td className="text-end tabular-nums">{Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—"}</td>
                <td className="text-end tabular-nums">{Number(l.tax ?? 0) > 0 ? fmt(l.tax) : "—"}</td>
                <td className="text-end tabular-nums font-medium">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={6} className="text-end">صافي المبلغ</td><td className="text-end tabular-nums">{fmt(subtotal)}</td></tr>
            {taxAmount > 0 && (
              <tr><td colSpan={6} className="text-end">الضريبة ({inv.taxPercent}%)</td><td className="text-end tabular-nums">{fmt(taxAmount)}</td></tr>
            )}
            {Number(inv.shippingAmount) > 0 && (
              <tr><td colSpan={6} className="text-end">الشحن</td><td className="text-end tabular-nums">{fmt(inv.shippingAmount)}</td></tr>
            )}
            <tr style={{ background: "#dbeafe" }}>
              <td colSpan={6} className="text-end font-bold">الإجمالي الكلي</td>
              <td className="text-end tabular-nums font-bold text-lg">{fmt(inv.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        {Number(inv.paidAmount) > 0 && (
          <div className="mb-4 flex justify-end gap-8 text-sm">
            <span className="text-gray-600">المدفوع: <strong className="tabular-nums">{fmt(inv.paidAmount)}</strong></span>
            <span className="text-gray-600">المتبقّي: <strong className="tabular-nums text-red-700">{fmt(inv.balanceDue)}</strong></span>
          </div>
        )}

        {inv.notes && (
          <div className="rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p>{inv.notes}</p>
          </div>
        )}

        <div className="mt-12 grid grid-cols-3 gap-8 text-sm text-gray-500">
          {["إعداد", "مراجعة", "اعتماد"].map((label) => (
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
