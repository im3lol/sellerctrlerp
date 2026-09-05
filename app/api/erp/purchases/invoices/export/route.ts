import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", POSTED: "مرحّلة", PARTIAL_PAID: "مدفوعة جزئياً", PAID: "مدفوعة", CANCELLED: "ملغاة",
};

/** Full-data Excel export of one or more purchase invoices — one row per line item. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const numbers = (new URL(req.url).searchParams.get("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!numbers.length) return new Response("لا توجد مستندات محددة", { status: 400 });

  const { invoices, supRows, lineRows } = await withOrgScope(orgId, false, async () => {
    const invoices = await db.select({
      id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date, status: purchaseInvoices.status,
      supplierId: purchaseInvoices.supplierId, shipping: purchaseInvoices.shippingAmount, discount: purchaseInvoices.discountAmount,
      tax: purchaseInvoices.taxAmount, total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, balanceDue: purchaseInvoices.balanceDue,
    }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.number, numbers)));
    if (!invoices.length) return { invoices, supRows: [], lineRows: [] };

    const invIds = invoices.map((i) => i.id);
    const supplierIds = [...new Set(invoices.map((i) => i.supplierId).filter((x): x is string => !!x))];
    const [supRows, lineRows] = await Promise.all([
      supplierIds.length
        ? db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, supplierIds))
        : Promise.resolve([]),
      db.select({
        invId: purchaseInvoiceLines.purchaseInvoiceId, code: items.code, name: items.nameAr,
        qty: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, discount: purchaseInvoiceLines.discountAmount,
        tax: purchaseInvoiceLines.taxAmount, shipping: purchaseInvoiceLines.shippingPerUnit, total: purchaseInvoiceLines.totalAmount,
      }).from(purchaseInvoiceLines).leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId)).where(inArray(purchaseInvoiceLines.purchaseInvoiceId, invIds)),
    ]);
    return { invoices, supRows, lineRows };
  });
  if (!invoices.length) return new Response("لا توجد مستندات مطابقة", { status: 404 });

  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linesByInv = new Map<string, typeof lineRows>();
  for (const l of lineRows) { const arr = linesByInv.get(l.invId) ?? []; arr.push(l); linesByInv.set(l.invId, arr); }

  const headers = ["رقم الفاتورة", "التاريخ", "المورد", "الحالة", "كود الصنف", "اسم الصنف", "الكمية", "السعر", "الخصم", "الضريبة", "شحن/وحدة", "إجمالي البند", "إجمالي الفاتورة", "المدفوع", "المتبقّي"];
  const rows: (string | number)[][] = [];
  for (const inv of invoices) {
    const sup = inv.supplierId ? supById.get(inv.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByInv.get(inv.id) ?? [];
    const base = [inv.number, xlsxDate(inv.date), supplierLabel, STATUS_LABEL[inv.status] ?? inv.status] as const;
    const tail = [Number(inv.total), Number(inv.paid), Number(inv.balanceDue)] as const;
    if (!lines.length) { rows.push([...base, "", "", "", "", "", "", "", ...tail]); continue; }
    for (const l of lines) {
      rows.push([...base, l.code ?? "", l.name ?? "", Number(l.qty), Number(l.unitPrice), Number(l.discount), Number(l.tax), Number(l.shipping), Number(l.total), ...tail]);
    }
  }

  return xlsxResponse({
    sheet: "فواتير الشراء",
    filename: numbers.length === 1 ? `purchase-invoice-${numbers[0]}` : `purchase-invoices-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 14, 26, 10, 12, 10, 10, 10, 12, 12, 12, 12],
  });
}
