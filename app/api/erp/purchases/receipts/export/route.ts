import { and, eq, inArray } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items, landedCostVouchers, landedCostVoucherLines } from "@/db/schema";
import { xlsxResponse, xlsxDate } from "@/lib/erp/xlsx";
import { receiptLineCosts } from "@/lib/erp/receipt-cost";

export const runtime = "nodejs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "مسودة", RECEIVED: "تم الاستلام", INVOICED: "مفوتر", REVERSED: "مرتجع",
};

/** Full-data Excel export of one or more goods receipts (إذن استلام) — one row per
 *  line item: what was physically received, and what it cost.
 *
 *  The cost used to be left out on the grounds that valuation lived on the order and the
 *  invoice. It doesn't: the receipt is what capitalised the stock, and the screen shows
 *  that figure, so an export without it was a document you couldn't check anything
 *  against. It comes from `receiptLineCosts` — the same function the screen and the GRNI
 *  posting use — rather than a second copy of the arithmetic. Money is gated exactly as
 *  the screen gates it: stores can receive without seeing what the goods cost. */
export async function GET(req: Request) {
  const { orgId, can } = await requireErpModule("purchases.view");
  const canSeeCost = can("purchases.create") || can("accounting.view");
  const numbers = (new URL(req.url).searchParams.get("numbers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!numbers.length) return new Response("لا توجد مستندات محددة", { status: 400 });

  const { receipts, supRows, lineRows, costs, landed } = await withOrgScope(orgId, false, async () => {
    const receipts = await db.select({
      id: purchaseReceipts.id, number: purchaseReceipts.number, date: purchaseReceipts.date, status: purchaseReceipts.status,
      supplierId: purchaseReceipts.supplierId, notes: purchaseReceipts.notes,
      purchaseOrderId: purchaseReceipts.purchaseOrderId, warehouseId: purchaseReceipts.warehouseId,
    }).from(purchaseReceipts).where(and(eq(purchaseReceipts.organizationId, orgId), inArray(purchaseReceipts.number, numbers)));
    if (!receipts.length) return { receipts, supRows: [], lineRows: [], costs: new Map<string, number>(), landed: new Map<string, number>() };

    const receiptIds = receipts.map((r) => r.id);
    const supplierIds = [...new Set(receipts.map((r) => r.supplierId).filter((x): x is string => !!x))];
    const [supRows, lineRows] = await Promise.all([
      supplierIds.length
        ? db.select({ id: suppliers.id, code: suppliers.code, name: suppliers.nameAr }).from(suppliers).where(inArray(suppliers.id, supplierIds))
        : Promise.resolve([]),
      db.select({
        receiptId: purchaseReceiptLines.purchaseReceiptId, itemId: purchaseReceiptLines.itemId, code: items.code, name: items.nameAr,
        qty: purchaseReceiptLines.quantity, rejected: purchaseReceiptLines.rejectedQty,
        batch: purchaseReceiptLines.batchNo, expiry: purchaseReceiptLines.expiryDate,
      }).from(purchaseReceiptLines).leftJoin(items, eq(items.id, purchaseReceiptLines.itemId)).where(inArray(purchaseReceiptLines.purchaseReceiptId, receiptIds)),
    ]);

    // Keyed by receipt+item, because the same item can be received on several of the
    // receipts in one export at different costs.
    const costs = new Map<string, number>();
    const landed = new Map<string, number>();
    if (canSeeCost) {
      for (const r of receipts) {
        for (const l of await receiptLineCosts(db, r)) costs.set(`${r.id}:${l.itemId}`, l.unitNet);
      }
      const lcv = await db.select({
        receiptId: landedCostVoucherLines.purchaseReceiptId, itemId: landedCostVoucherLines.itemId, perUnit: landedCostVoucherLines.perUnit,
      }).from(landedCostVoucherLines)
        .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
        .where(and(
          inArray(landedCostVoucherLines.purchaseReceiptId, receiptIds),
          eq(landedCostVouchers.organizationId, orgId),
          eq(landedCostVouchers.status, "POSTED"),
        ));
      for (const v of lcv) {
        const k = `${v.receiptId}:${v.itemId}`;
        landed.set(k, (landed.get(k) ?? 0) + Number(v.perUnit));
      }
    }
    return { receipts, supRows, lineRows, costs, landed };
  });
  if (!receipts.length) return new Response("لا توجد مستندات مطابقة", { status: 404 });

  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linesByReceipt = new Map<string, typeof lineRows>();
  for (const l of lineRows) { const arr = linesByReceipt.get(l.receiptId) ?? []; arr.push(l); linesByReceipt.set(l.receiptId, arr); }

  const costHeaders = ["تكلفة البضاعة/وحدة", "تكاليف استيراد/وحدة", "تكلفة القطعة الشاملة", "الإجمالي"];
  const headers = ["رقم الإذن", "التاريخ", "المورد", "الحالة", "كود الصنف", "اسم الصنف", "الكمية المستلمة", "الكمية المرفوضة",
    ...(canSeeCost ? costHeaders : []), "رقم اللوت", "تاريخ الصلاحية", "ملاحظات"];
  const rows: (string | number)[][] = [];
  for (const r of receipts) {
    const sup = r.supplierId ? supById.get(r.supplierId) : undefined;
    const supplierLabel = sup ? `${sup.code} — ${sup.name}` : "—";
    const lines = linesByReceipt.get(r.id) ?? [];
    const base = [r.number, xlsxDate(r.date), supplierLabel, STATUS_LABEL[r.status] ?? r.status] as const;
    const blank = canSeeCost ? ["", "", "", "", "", "", "", "", "", ""] : ["", "", "", "", "", ""];
    if (!lines.length) { rows.push([...base, ...blank, r.notes ?? ""]); continue; }
    for (const l of lines) {
      const goods = costs.get(`${r.id}:${l.itemId}`) ?? 0;
      const lc = landed.get(`${r.id}:${l.itemId}`) ?? 0;
      const allIn = goods + lc;
      rows.push([...base, l.code ?? "", l.name ?? "", Number(l.qty), Number(l.rejected),
        ...(canSeeCost ? [goods, lc, allIn, Number(l.qty) * allIn] : []),
        l.batch ?? "", xlsxDate(l.expiry), r.notes ?? ""]);
    }
  }

  return xlsxResponse({
    sheet: "أذون الاستلام",
    filename: numbers.length === 1 ? `purchase-receipt-${numbers[0]}` : `purchase-receipts-${numbers.length}`,
    headers, rows,
    colWidths: [14, 12, 24, 12, 14, 26, 12, 12, ...(canSeeCost ? [16, 18, 20, 14] : []), 14, 14, 20],
  });
}
