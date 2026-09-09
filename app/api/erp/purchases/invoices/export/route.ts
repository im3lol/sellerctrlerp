import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items, purchaseReceiptLines, landedCostVouchers, landedCostVoucherLines } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { unitAllIn } from "@/lib/erp/money";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", POSTED: "مرحّلة", PARTIAL_PAID: "مدفوعة جزئياً", PAID: "مدفوعة", CANCELLED: "ملغاة",
};

/** Full-data Excel export of one or more purchase invoices — one row per line item. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const numbers = (new URL(req.url).searchParams.get("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!numbers.length) return new Response("لا توجد مستندات محددة", { status: 400 });

  const { invoices, supRows, lineRows, landed, capTax } = await withOrgScope(orgId, false, async () => {
    const invoices = await db.select({
      id: purchaseInvoices.id, number: purchaseInvoices.number, date: purchaseInvoices.date, status: purchaseInvoices.status,
      supplierId: purchaseInvoices.supplierId, goodsReceiptId: purchaseInvoices.goodsReceiptId,
      shipping: purchaseInvoices.shippingAmount, discount: purchaseInvoices.discountAmount,
      tax: purchaseInvoices.taxAmount, total: purchaseInvoices.totalAmount, paid: purchaseInvoices.paidAmount, balanceDue: purchaseInvoices.balanceDue,
      currency: purchaseInvoices.currencyCode, rate: purchaseInvoices.exchangeRate, rateSource: purchaseInvoices.rateSource,
    }).from(purchaseInvoices).where(and(eq(purchaseInvoices.organizationId, orgId), inArray(purchaseInvoices.number, numbers)));
    if (!invoices.length) return { invoices, supRows: [], lineRows: [], landed: new Map<string, number>(), capTax: new Map<string, number>() };

    const invIds = invoices.map((i) => i.id);
    const supplierIds = [...new Set(invoices.map((i) => i.supplierId).filter((x): x is string => !!x))];
    const [supRows, lineRows] = await Promise.all([
      supplierIds.length
        ? db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, supplierIds))
        : Promise.resolve([]),
      db.select({
        invId: purchaseInvoiceLines.purchaseInvoiceId, itemId: purchaseInvoiceLines.itemId, code: items.code, name: items.nameAr,
        qty: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, discount: purchaseInvoiceLines.discountAmount,
        tax: purchaseInvoiceLines.taxAmount, shipping: purchaseInvoiceLines.shippingPerUnit, total: purchaseInvoiceLines.totalAmount,
      }).from(purchaseInvoiceLines).leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId)).where(inArray(purchaseInvoiceLines.purchaseInvoiceId, invIds)),
    ]);

    // Import costs and the capitalised VAT both live on the GOODS RECEIPT, not on this
    // bill — same sources the invoice screen reads, so the sheet and the screen agree.
    // Keyed by invoice+item because one export can span several invoices.
    const grnIds = invoices.map((i) => i.goodsReceiptId).filter((x): x is string => !!x);
    const landed = new Map<string, number>();
    const capTax = new Map<string, number>();
    if (grnIds.length) {
      const invByGrn = new Map(invoices.filter((i) => i.goodsReceiptId).map((i) => [i.goodsReceiptId!, i.id]));
      const [lcv, grnLines] = await Promise.all([
        db.select({ receiptId: landedCostVoucherLines.purchaseReceiptId, itemId: landedCostVoucherLines.itemId, perUnit: landedCostVoucherLines.perUnit })
          .from(landedCostVoucherLines)
          .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
          .where(and(
            inArray(landedCostVoucherLines.purchaseReceiptId, grnIds),
            eq(landedCostVouchers.organizationId, orgId),
            eq(landedCostVouchers.status, "POSTED"),
          )),
        db.select({ receiptId: purchaseReceiptLines.purchaseReceiptId, itemId: purchaseReceiptLines.itemId, taxPerUnit: purchaseReceiptLines.taxPerUnit })
          .from(purchaseReceiptLines).where(inArray(purchaseReceiptLines.purchaseReceiptId, grnIds)),
      ]);
      for (const v of lcv) {
        const k = `${invByGrn.get(v.receiptId)}:${v.itemId}`;
        landed.set(k, (landed.get(k) ?? 0) + Number(v.perUnit));
      }
      for (const g of grnLines) capTax.set(`${invByGrn.get(g.receiptId)}:${g.itemId}`, Number(g.taxPerUnit));
    }
    return { invoices, supRows, lineRows, landed, capTax };
  });
  if (!invoices.length) return new Response("لا توجد مستندات مطابقة", { status: 404 });

  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linesByInv = new Map<string, typeof lineRows>();
  for (const l of lineRows) { const arr = linesByInv.get(l.invId) ?? []; arr.push(l); linesByInv.set(l.invId, arr); }

  // Amounts are stored in base. The sheet used to print them with no currency column at
  // all, which is unreadable for an invoice raised in dirhams: nothing on the row said
  // what the numbers were, or at what rate. Each money column now names its currency and
  // the approved rate travels with the row.
  const baseCode = await getBaseCurrencyCode(orgId);
  const toDoc = (v: unknown, rate: number) => (rate > 0 ? Math.round((Number(v ?? 0) / rate) * 10000) / 10000 : Number(v ?? 0));

  const headers = [
    "رقم الفاتورة", "التاريخ", "المورد", "الحالة",
    "العملة", "سعر الصرف", "مصدر السعر",
    "كود الصنف", "اسم الصنف", "الكمية",
    "سعر الوحدة (بعملة الفاتورة)", "خصم البند (بعملة الفاتورة)", "ضريبة البند (بعملة الفاتورة)",
    "شحن/وحدة (بعملة الفاتورة)", "إجمالي البند (بعملة الفاتورة)",
    `سعر الوحدة (${baseCode})`, `إجمالي البند شامل الشحن (${baseCode})`,
    `تكاليف استيراد/وحدة (${baseCode})`, `تكلفة القطعة الشاملة (${baseCode})`, `التكلفة الشاملة للبند (${baseCode})`,
    "إجمالي الفاتورة (بعملة الفاتورة)", `إجمالي الفاتورة (${baseCode})`,
    `المدفوع (${baseCode})`, `المتبقّي (${baseCode})`,
  ];
  const rows: (string | number)[][] = [];
  for (const inv of invoices) {
    const sup = inv.supplierId ? supById.get(inv.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByInv.get(inv.id) ?? [];
    const cur = inv.currency ?? baseCode;
    const rate = Number(inv.rate) || 1;

    const head = [
      inv.number, xlsxDate(inv.date), supplierLabel, STATUS_LABEL[inv.status] ?? inv.status,
      cur, rate, inv.rateSource === "MANUAL" ? "يدوي" : "تلقائي",
    ] as const;
    const tail = [
      toDoc(inv.total, rate), Number(inv.total), Number(inv.paid), Number(inv.balanceDue),
    ] as const;

    if (!lines.length) { rows.push([...head, "", "", "", "", "", "", "", "", "", "", "", "", "", ...tail]); continue; }
    for (const l of lines) {
      // Only VAT the receipt actually capitalised belongs in the cost; recoverable VAT is
      // an asset against the tax authority, not part of what the goods cost.
      const lc = landed.get(`${inv.id}:${l.itemId}`) ?? 0;
      const q = Number(l.qty);
      const unit = unitAllIn({
        quantity: q, unitPrice: Number(l.unitPrice), shippingPerUnit: Number(l.shipping),
        taxAmount: q * (capTax.get(`${inv.id}:${l.itemId}`) ?? 0),
        discountAmount: Number(l.discount), landedPerUnit: lc,
      });
      rows.push([
        ...head,
        l.code ?? "", l.name ?? "", Number(l.qty),
        toDoc(l.unitPrice, rate), toDoc(l.discount, rate), toDoc(l.tax, rate),
        toDoc(l.shipping, rate), toDoc(l.total, rate),
        Number(l.unitPrice), Number(l.total),
        lc, unit, Math.round(Number(l.qty) * unit * 100) / 100,
        ...tail,
      ]);
    }
  }

  return xlsxResponse({
    sheet: "فواتير الشراء",
    filename: numbers.length === 1 ? `purchase-invoice-${numbers[0]}` : `purchase-invoices-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 8, 12, 11, 14, 30, 9, 18, 18, 18, 18, 20, 14, 22, 20, 22, 22, 20, 18, 12, 12],
  });
}
