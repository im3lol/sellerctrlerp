import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, organizations, warehouses } from "@/db/schema";

const fmt = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const dt = (d: Date) =>
  new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "long", day: "numeric" });

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "مستلم جزئيًا",
  RECEIVED: "مستلم", INVOICED: "مُفاتَر", CANCELLED: "ملغى",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintPurchaseOrderPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.view");

  const [po] = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId)))
    .limit(1);
  if (!po) notFound();

  const [org] = await db
    .select({ nameAr: organizations.nameAr, address: organizations.address, phone: organizations.phone, taxNumber: organizations.taxNumber })
    .from(organizations).where(eq(organizations.id, orgId));

  const [supp] = po.supplierId
    ? await db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
        .from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1)
    : [undefined];

  const [wh] = po.warehouseId
    ? await db.select({ nameAr: warehouses.nameAr }).from(warehouses).where(eq(warehouses.id, po.warehouseId)).limit(1)
    : [undefined];

  const lines = await db
    .select({
      qty: purchaseOrderLines.quantity,
      receivedQty: purchaseOrderLines.receivedQty,
      unitPrice: purchaseOrderLines.unitPrice,
      discount: purchaseOrderLines.discountAmount,
      tax: purchaseOrderLines.taxAmount,
      total: purchaseOrderLines.totalAmount,
      code: items.code,
      name: items.nameAr,
    })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.purchaseOrderId, po.id));

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
        <a href={`/erp/purchases/orders/${encodeURIComponent(raw)}`} className="rounded border px-4 py-2 text-sm font-medium shadow hover:bg-muted">رجوع</a>
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
            <p className="text-lg font-bold text-gray-700">أمر شراء</p>
            <p className="mt-1 text-2xl font-mono font-bold text-primary">{po.number}</p>
            <p className="mt-1 text-sm text-gray-500">التاريخ: {dt(po.date)}</p>
            <p className="text-sm text-gray-500">الحالة: {STATUS[po.status] ?? po.status}</p>
          </div>
        </div>

        {/* Supplier + Warehouse */}
        <div className="mb-6 grid grid-cols-2 gap-4">
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">المورّد</p>
            <p className="mt-1 font-semibold">{supp?.nameAr ?? "—"}</p>
            {supp?.phone   && <p className="text-sm text-gray-600">هاتف: {supp.phone}</p>}
            {supp?.address && <p className="text-sm text-gray-600">{supp.address}</p>}
          </div>
          <div className="rounded-lg border bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">مستودع الاستلام</p>
            <p className="mt-1 font-semibold">{wh?.nameAr ?? "—"}</p>
          </div>
        </div>

        {/* Lines */}
        <table className="mb-6 text-sm">
          <thead>
            <tr>
              <th className="text-start">#</th>
              <th className="text-start">الصنف</th>
              <th className="text-center">الكمية</th>
              <th className="text-center">المستلم</th>
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
                <td className="text-center tabular-nums text-gray-500">{qty(l.receivedQty)}</td>
                <td className="text-end tabular-nums">{fmt(l.unitPrice)}</td>
                <td className="text-end tabular-nums">{Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—"}</td>
                <td className="text-end tabular-nums">{Number(l.tax ?? 0) > 0 ? fmt(l.tax) : "—"}</td>
                <td className="text-end tabular-nums font-medium">{fmt(l.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {Number(po.discountAmount) > 0 && (
              <tr><td colSpan={7} className="text-end">الخصم</td><td className="text-end tabular-nums">{fmt(po.discountAmount)}</td></tr>
            )}
            {Number(po.shippingAmount) > 0 && (
              <tr><td colSpan={7} className="text-end">الشحن</td><td className="text-end tabular-nums">{fmt(po.shippingAmount)}</td></tr>
            )}
            {Number(po.taxAmount) > 0 && (
              <tr><td colSpan={7} className="text-end">الضريبة ({po.taxPercent}%)</td><td className="text-end tabular-nums">{fmt(po.taxAmount)}</td></tr>
            )}
            <tr style={{ background: "#dbeafe" }}>
              <td colSpan={7} className="text-end font-bold">الإجمالي الكلي</td>
              <td className="text-end tabular-nums font-bold text-lg">{fmt(po.totalAmount)}</td>
            </tr>
          </tfoot>
        </table>

        {po.notes && (
          <div className="rounded-lg border p-3 text-sm text-gray-700">
            <p className="font-medium">ملاحظات:</p>
            <p className="mt-1">{po.notes}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-3 gap-8 text-sm text-gray-500">
          {["إعداد", "اعتماد", "المورّد"].map((label) => (
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
