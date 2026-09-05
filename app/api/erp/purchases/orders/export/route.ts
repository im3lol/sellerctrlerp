import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseOrders, purchaseOrderLines, suppliers, items } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "استلام جزئي",
  RECEIVED: "تم الاستلام", INVOICED: "مفوتر", CANCELLED: "ملغى",
};

/** Full-data Excel export of one or more purchase orders — one row per line item
 *  (header fields repeated), so 1 or N documents export through the same shape. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const numbers = (new URL(req.url).searchParams.get("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!numbers.length) return new Response("لا توجد مستندات محددة", { status: 400 });

  const { orders, supRows, lineRows } = await withOrgScope(orgId, false, async () => {
    const orders = await db.select({
      id: purchaseOrders.id, number: purchaseOrders.number, date: purchaseOrders.date, status: purchaseOrders.status,
      supplierId: purchaseOrders.supplierId, shipping: purchaseOrders.shippingAmount, tax: purchaseOrders.taxAmount,
      total: purchaseOrders.totalAmount, currency: purchaseOrders.currencyCode, notes: purchaseOrders.notes,
    }).from(purchaseOrders).where(and(eq(purchaseOrders.organizationId, orgId), inArray(purchaseOrders.number, numbers)));
    if (!orders.length) return { orders, supRows: [], lineRows: [] };

    const orderIds = orders.map((o) => o.id);
    const supplierIds = [...new Set(orders.map((o) => o.supplierId).filter((x): x is string => !!x))];
    const [supRows, lineRows] = await Promise.all([
      supplierIds.length
        ? db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, supplierIds))
        : Promise.resolve([]),
      db.select({
        orderId: purchaseOrderLines.purchaseOrderId, code: items.code, name: items.nameAr,
        qty: purchaseOrderLines.quantity, unitPrice: purchaseOrderLines.unitPrice, discount: purchaseOrderLines.discountAmount,
        tax: purchaseOrderLines.taxAmount, shipping: purchaseOrderLines.shippingPerUnit, total: purchaseOrderLines.totalAmount,
      }).from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds)),
    ]);
    return { orders, supRows, lineRows };
  });
  if (!orders.length) return new Response("لا توجد مستندات مطابقة", { status: 404 });

  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linesByOrder = new Map<string, typeof lineRows>();
  for (const l of lineRows) { const arr = linesByOrder.get(l.orderId) ?? []; arr.push(l); linesByOrder.set(l.orderId, arr); }

  const headers = ["رقم الأمر", "التاريخ", "المورد", "الحالة", "كود الصنف", "اسم الصنف", "الكمية", "السعر", "الخصم", "الضريبة", "شحن/وحدة", "إجمالي البند", "العملة", "إجمالي الأمر", "شحن الأمر", "ضريبة الأمر", "ملاحظات"];
  const rows: (string | number)[][] = [];
  for (const o of orders) {
    const sup = o.supplierId ? supById.get(o.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByOrder.get(o.id) ?? [];
    const base = [o.number, xlsxDate(o.date), supplierLabel, STATUS_LABEL[o.status] ?? o.status] as const;
    const tail = [o.currency ?? "EGP", Number(o.total), Number(o.shipping), Number(o.tax), o.notes ?? ""] as const;
    if (!lines.length) { rows.push([...base, "", "", "", "", "", "", "", ...tail]); continue; }
    for (const l of lines) {
      rows.push([...base, l.code ?? "", l.name ?? "", Number(l.qty), Number(l.unitPrice), Number(l.discount), Number(l.tax), Number(l.shipping), Number(l.total), ...tail]);
    }
  }

  return xlsxResponse({
    sheet: "أوامر الشراء",
    filename: numbers.length === 1 ? `purchase-order-${numbers[0]}` : `purchase-orders-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 14, 26, 10, 12, 10, 10, 10, 12, 8, 12, 10, 10, 20],
  });
}
