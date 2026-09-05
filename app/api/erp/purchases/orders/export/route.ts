import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseOrders, purchaseOrderLines, suppliers, items } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";
import { getBaseCurrencyCode } from "@/lib/erp/currency";

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
      total: purchaseOrders.totalAmount, currency: purchaseOrders.currencyCode,
      rate: purchaseOrders.exchangeRate, rateSource: purchaseOrders.rateSource, notes: purchaseOrders.notes,
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

  // Every amount in the database is in BASE currency. The old sheet dumped those figures
  // straight out and put the order's currency code in a column beside them — so an order
  // placed in dirhams exported pounds labelled AED, and there was no rate anywhere to
  // catch it. Each money column now says which currency it is in, and the rate that
  // connects the two travels with the row.
  const baseCode = await getBaseCurrencyCode(orgId);
  /** base → the order's own currency, at 4dp (a reported figure, not a posted one) */
  const toDoc = (v: unknown, rate: number) => (rate > 0 ? Math.round((Number(v ?? 0) / rate) * 10000) / 10000 : Number(v ?? 0));

  const headers = [
    "رقم الأمر", "التاريخ", "المورد", "الحالة",
    "العملة", "سعر الصرف", "مصدر السعر",
    "كود الصنف", "اسم الصنف", "الكمية",
    "سعر الوحدة (بعملة الأمر)", "خصم البند (بعملة الأمر)", "شحن/وحدة (بعملة الأمر)",
    "ضريبة البند (بعملة الأمر)", "إجمالي البند (بعملة الأمر)",
    `سعر الوحدة (${baseCode})`, `إجمالي البند شامل الشحن (${baseCode})`,
    "إجمالي الأمر (بعملة الأمر)", `إجمالي الأمر شامل الشحن (${baseCode})`,
    `شحن الأمر (${baseCode})`, `ضريبة الأمر (${baseCode})`,
    "ملاحظات",
  ];

  const rows: (string | number)[][] = [];
  for (const o of orders) {
    const sup = o.supplierId ? supById.get(o.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByOrder.get(o.id) ?? [];
    const cur = o.currency ?? baseCode;
    const rate = Number(o.rate) || 1;

    const head = [
      o.number, xlsxDate(o.date), supplierLabel, STATUS_LABEL[o.status] ?? o.status,
      cur, rate, o.rateSource === "MANUAL" ? "يدوي" : "تلقائي",
    ] as const;
    // Order-level figures repeat on every line, in both currencies, so a row can be read
    // on its own without scrolling back to a header block.
    const tail = [
      toDoc(o.total, rate), Number(o.total), Number(o.shipping), Number(o.tax), o.notes ?? "",
    ] as const;

    if (!lines.length) { rows.push([...head, "", "", "", "", "", "", "", "", "", "", ...tail]); continue; }
    for (const l of lines) {
      rows.push([
        ...head,
        l.code ?? "", l.name ?? "", Number(l.qty),
        toDoc(l.unitPrice, rate), toDoc(l.discount, rate), toDoc(l.shipping, rate),
        toDoc(l.tax, rate), toDoc(l.total, rate),
        Number(l.unitPrice), Number(l.total),
        ...tail,
      ]);
    }
  }

  return xlsxResponse({
    sheet: "أوامر الشراء",
    filename: numbers.length === 1 ? `purchase-order-${numbers[0]}` : `purchase-orders-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 8, 12, 11, 14, 30, 9, 16, 16, 16, 16, 18, 14, 20, 16, 20, 12, 12, 20],
  });
}
