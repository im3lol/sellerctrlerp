import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items, organizations, warehouses } from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_DELIVERED: "تسليم جزئي",
  DELIVERED: "تم التسليم", INVOICED: "مُفاتَر", CANCELLED: "ملغى",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintSalesOrderPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.view");

  const [so] = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId)))
    .limit(1);
  if (!so) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations).where(eq(organizations.id, orgId));

  const [cust] = so.customerId
    ? await db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address, email: customers.email })
        .from(customers).where(eq(customers.id, so.customerId)).limit(1)
    : [undefined];

  const lines = await db
    .select({
      qty: salesOrderLines.quantity,
      deliveredQty: salesOrderLines.deliveredQty,
      unitPrice: salesOrderLines.unitPrice,
      discount: salesOrderLines.discountAmount,
      tax: salesOrderLines.taxAmount,
      total: salesOrderLines.totalAmount,
      code: items.code,
      name: items.nameAr,
    })
    .from(salesOrderLines)
    .leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, so.id));

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
        <a href={`/erp/sales/orders/${encodeURIComponent(raw)}`} className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted">رجوع</a>
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
            <p className="text-lg font-bold text-gray-700">أمر بيع</p>
            <p className="mt-1 text-2xl font-mono font-bold text-primary">{so.number}</p>
            <p className="mt-1 text-sm text-gray-500">التاريخ: {dt(so.date)}</p>
            {so.dueDate && <p className="text-sm text-gray-500">تاريخ التسليم: {dt(so.dueDate)}</p>}
            <p className="text-sm text-gray-500">الحالة: {STATUS[so.status] ?? so.status}</p>
          </div>
        </div>

        {/* Customer */}
        <div className="mb-6">
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">العميل</p>
            <p className="mt-1 font-semibold">{cust?.nameAr ?? "—"}</p>
            {cust?.phone   && <p className="text-sm text-gray-600">هاتف: {cust.phone}</p>}
            {cust?.email   && <p className="text-sm text-gray-600">بريد: {cust.email}</p>}
            {cust?.address && <p className="text-sm text-gray-600">{cust.address}</p>}
          </div>
        </div>

        {/* Lines */}
        <table className="mb-6 text-sm">
          <thead>
            <tr>
              <th className="text-start">#</th>
              <th className="text-start">الصنف</th>
              <th className="text-center">الكمية</th>
              <th className="text-center">المُسلَّم</th>
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
                <td className="text-center tabular-nums text-gray-500">{qty(l.deliveredQty)}</td>
                <td className="text-end tabular-nums">{fmt(l.unitPrice)}</td>
                <td className="text-end tabular-nums">{Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—"}</td>
                <td className="text-end tabular-nums">{Number(l.tax ?? 0) > 0 ? fmt(l.tax) : "—"}</td>
                <td className="text-end tabular-nums font-medium">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Number(so.discountAmount) > 0 && (
              <tr><td colSpan={7} className="text-end">الخصم</td><td className="text-end tabular-nums">{fmt(so.discountAmount)}</td></tr>
            )}
            {Number(so.taxAmount) > 0 && (
              <tr><td colSpan={7} className="text-end">الضريبة ({so.taxPercent}%)</td><td className="text-end tabular-nums">{fmt(so.taxAmount)}</td></tr>
            )}
            <tr style={{ background: "#dcfce7" }}>
              <td colSpan={7} className="text-end font-bold">الإجمالي الكلي</td>
              <td className="text-end tabular-nums font-bold text-lg">{fmt(so.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        {so.notes && (
          <div className="rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p className="mt-1">{so.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-3 gap-8 text-sm text-gray-500">
          {["إعداد", "اعتماد", "العميل"].map((label) => (
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
