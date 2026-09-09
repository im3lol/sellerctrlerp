import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items, warehouses, landedCostVouchers, landedCostVoucherLines } from "@/db/schema";
import { qty, dt, fmt } from "@/lib/erp/print-format";
import { receiptLineCosts } from "@/lib/erp/receipt-cost";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", RECEIVED: "تم الاستلام", INVOICED: "مفوتر", REVERSED: "مرتجع",
};

type Params = { params: Promise<{ number: string }> };

/**
 * إذن الاستلام — what the storekeeper actually counted, and what it cost.
 *
 * The rejected column is the point of it: it's the evidence behind a short-delivery claim.
 *
 * Cost was deliberately left off this sheet — it's signed by the supplier's driver, and
 * you don't hand someone your landed cost. It's here now because the receipt is what
 * capitalised the stock and the owner wants it on the document, but it's gated twice: the
 * viewer needs purchases.create or accounting.view, AND the columns are ordinary print
 * columns, so «الإعدادات ← الطباعة» can switch them off for the copy that gets signed.
 */
export default async function PrintGoodsReceiptPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    const canSeeCost = can("purchases.create") || can("accounting.view");
    const [grn] = await db
      .select()
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.number, raw), eq(purchaseReceipts.organizationId, orgId)))
      .limit(1);
    if (!grn) notFound();

    const [{ org, hiddenFor, footerText }, supp, wh, lines] = await Promise.all([
      loadPrintHeader(orgId),
      grn.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, grn.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      db.select({ nameAr: warehouses.nameAr }).from(warehouses)
        .where(eq(warehouses.id, grn.warehouseId)).limit(1).then((r) => r[0]),
      db
        .select({
          itemId: purchaseReceiptLines.itemId,
          qty: purchaseReceiptLines.quantity,
          rejectedQty: purchaseReceiptLines.rejectedQty,
          batchNo: purchaseReceiptLines.batchNo,
          expiryDate: purchaseReceiptLines.expiryDate,
          code: items.code,
          name: items.nameAr,
          image: items.image,
        })
        .from(purchaseReceiptLines)
        .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
        .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id)),
    ]);

    // Same figures the screen and the GRNI posting use — `receiptLineCosts`, not a second
    // copy of the arithmetic — plus whatever POSTED import-cost vouchers loaded on.
    const costByItem = new Map<string, number>();
    const landedByItem = new Map<string, number>();
    if (canSeeCost) {
      for (const l of await receiptLineCosts(db, grn)) costByItem.set(l.itemId, l.unitNet);
      const lcv = await db.select({ itemId: landedCostVoucherLines.itemId, perUnit: landedCostVoucherLines.perUnit })
        .from(landedCostVoucherLines)
        .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
        .where(and(
          eq(landedCostVoucherLines.purchaseReceiptId, grn.id),
          eq(landedCostVouchers.organizationId, orgId),
          eq(landedCostVouchers.status, "POSTED"),
        ));
      for (const v of lcv) landedByItem.set(v.itemId, (landedByItem.get(v.itemId) ?? 0) + Number(v.perUnit));
    }
    const unitAllInFor = (itemId: string) => (costByItem.get(itemId) ?? 0) + (landedByItem.get(itemId) ?? 0);
    const totalValue = lines.reduce((s, l) => s + Number(l.qty ?? 0) * unitAllInFor(l.itemId), 0);

    const accepted = lines.reduce((s, l) => s + Number(l.qty ?? 0), 0);
    const rejected = lines.reduce((s, l) => s + Number(l.rejectedQty ?? 0), 0);
    // Only show the batch column when the goods are actually batch-tracked.
    const hasBatch = lines.some((l) => l.batchNo || l.expiryDate);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("purchase-receipt")}
        footerText={footerText}
        title="إذن استلام"
        number={grn.number}
        watermark={grn.status === "DRAFT" ? "مسودة" : undefined}
        backHref={`/purchases/receipts/${encodeURIComponent(raw)}`}
        meta={[
          { label: "التاريخ", value: dt(grn.date) },
          { label: "الحالة", value: STATUS[grn.status] ?? grn.status },
        ]}
        parties={[
          ...(supp ? [{ label: "المورّد", name: supp.nameAr, lines: [supp.address, supp.phone] }] : []),
          ...(wh ? [{ label: "الاستلام في", name: wh.nameAr, lines: [] }] : []),
        ]}
        columns={[
          { label: "#", width: "4%" },
          // A normal print column, so it can be switched off in the org's print settings.
          { label: "صورة", align: "center" as const, width: "9%" },
          { label: "الصنف", width: hasBatch ? "34%" : "54%" },
          ...(hasBatch ? [{ label: "التشغيلة / الصلاحية", width: "20%" }] : []),
          { label: "المستلم", align: "end" as const, width: canSeeCost ? "10%" : "16%" },
          { label: "المرفوض", align: "end" as const, width: canSeeCost ? "10%" : "17%" },
          ...(canSeeCost ? [
            { label: "تكلفة القطعة الشاملة", align: "end" as const, width: "14%" },
            { label: "الإجمالي", align: "end" as const, width: "13%" },
          ] : []),
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          // Real <img> (print drops CSS backgrounds, not images), fixed box so a tall
          // picture cannot stretch the row, and nothing when the item has no image.
          // Not lazy: a lazy image can still be unloaded when the print dialog fires.
          <span key="img" style={{ display: "inline-block", width: 36, height: 36, verticalAlign: "middle" }}>
            {l.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            ) : null}
          </span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          ...(hasBatch ? [
            <span key="b" style={{ fontSize: 10.5, color: "#5b6478" }}>
              {[l.batchNo, l.expiryDate ? dt(l.expiryDate) : null].filter(Boolean).join(" · ") || "—"}
            </span>,
          ] : []),
          <b key="q">{qty(l.qty)}</b>,
          <span key="r" style={{ color: Number(l.rejectedQty ?? 0) > 0 ? "#d64545" : "#8a93a6" }}>
            {Number(l.rejectedQty ?? 0) > 0 ? qty(l.rejectedQty) : "—"}
          </span>,
          ...(canSeeCost ? [
            <b key="u">{fmt(unitAllInFor(l.itemId))}</b>,
            <span key="v">{fmt(Number(l.qty ?? 0) * unitAllInFor(l.itemId))}</span>,
          ] : []),
        ])}
        totals={[
          ...(rejected > 0 ? [{ label: "إجمالي المرفوض", value: qty(rejected), tone: "danger" as const }] : []),
          // Without cost the received quantity IS the bottom line, so it stays in `balance`
          // alone; with cost it moves up here and the value takes the bottom line.
          ...(canSeeCost ? [{ label: "إجمالي المستلم", value: qty(accepted) }] : []),
        ]}
        balance={canSeeCost
          ? { label: "قيمة البضاعة الشاملة", value: fmt(totalValue) }
          : { label: "إجمالي المستلم", value: qty(accepted) }}
        note={grn.notes}
        signatures={["المورّد", "أمين المخزن", "الفحص"]}
      />
    );
  });
}
