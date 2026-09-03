import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", RECEIVED: "تم الاستلام", INVOICED: "مفوتر", REVERSED: "مرتجع",
};

/** Full-data Excel export of one or more goods receipts (إذن استلام) — one row per
 *  line item. No pricing here (valuation lives on the order/invoice), just what was
 *  physically received: quantity, rejected quantity, batch, expiry. */
export async function GET(req: Request) {
  const { orgId } = await requireErpModule("purchases.view");
  const numbers = (new URL(req.url).searchParams.get("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!numbers.length) return new Response("لا توجد مستندات محددة", { status: 400 });

  const { receipts, supRows, lineRows } = await withOrgScope(orgId, false, async () => {
    const receipts = await db.select({
      id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, status: purchaseReceipts.status,
      supplierId: purchaseReceipts.supplierId, notes: purchaseReceipts.notes,
    }).from(purchaseReceipts).where(and(eq(purchaseReceipts.organizationId, orgId), inArray(purchaseReceipts.number, numbers)));
    if (!receipts.length) return { receipts, supRows: [], lineRows: [] };

    const receiptIds = receipts.map((r) => r.id);
    const supplierIds = [...new Set(receipts.map((r) => r.supplierId).filter((x): x is string => !!x))];
    const [supRows, lineRows] = await Promise.all([
      supplierIds.length
        ? db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, supplierIds))
        : Promise.resolve([]),
      db.select({
        receiptId: purchaseReceiptLines.purchaseReceiptId, code: items.code, name: items.nameAr,
        qty: purchaseReceiptLines.quantity, rejected: purchaseReceiptLines.rejectedQty,
        batch: purchaseReceiptLines.batchNo, expiry: purchaseReceiptLines.expiryDate,
      }).from(purchaseReceiptLines).leftJoin(items, eq(items.id, purchaseReceiptLines.itemId)).where(inArray(purchaseReceiptLines.purchaseReceiptId, receiptIds)),
    ]);
    return { receipts, supRows, lineRows };
  });
  if (!receipts.length) return new Response("لا توجد مستندات مطابقة", { status: 404 });

  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linesByReceipt = new Map<string, typeof lineRows>();
  for (const l of lineRows) { const arr = linesByReceipt.get(l.receiptId) ?? []; arr.push(l); linesByReceipt.set(l.receiptId, arr); }

  const headers = ["رقم الإذن", "التاريخ", "المورد", "الحالة", "كود الصنف", "اسم الصنف", "الكمية المستلمة", "الكمية المرفوضة", "رقم اللوت", "تاريخ الصلاحية", "ملاحظات"];
  const rows: (string | number)[][] = [];
  for (const r of receipts) {
    const sup = r.supplierId ? supById.get(r.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByReceipt.get(r.id) ?? [];
    const base = [r.number, xlsxDate(r.date), supplierLabel, STATUS_LABEL[r.status] ?? r.status] as const;
    if (!lines.length) { rows.push([...base, "", "", "", "", "", "", r.notes ?? ""]); continue; }
    for (const l of lines) {
      rows.push([...base, l.code ?? "", l.name ?? "", Number(l.qty), Number(l.rejected), l.batch ?? "", xlsxDate(l.expiry), r.notes ?? ""]);
    }
  }

  return xlsxResponse({
    sheet: "أذون الاستلام",
    filename: numbers.length === 1 ? `purchase-receipt-${numbers[0]}` : `purchase-receipts-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 14, 26, 12, 12, 14, 14, 20],
  });
}
