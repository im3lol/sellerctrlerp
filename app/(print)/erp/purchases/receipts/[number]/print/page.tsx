import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseReceiptLines, suppliers, items, warehouses } from "@/db/schema";
import { qty, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", RECEIVED: "تم الاستلام", INVOICED: "مفوتر", REVERSED: "مرتجع",
};

type Params = { params: Promise<{ number: string }> };

/**
 * إذن الاستلام — what the storekeeper actually counted.
 *
 * No prices, like the delivery note: this is the inspection record, and the rejected
 * column is the point of it — it's the evidence behind a short-delivery claim.
 */
export default async function PrintGoodsReceiptPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [grn] = await db
      .select()
      .from(purchaseReceipts)
      .where(and(eq(purchaseReceipts.number, raw), eq(purchaseReceipts.organizationId, orgId)))
      .limit(1);
    if (!grn) notFound();

    const [{ org }, supp, wh, lines] = await Promise.all([
      loadPrintHeader(orgId),
      grn.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, grn.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      db.select({ nameAr: warehouses.nameAr }).from(warehouses)
        .where(eq(warehouses.id, grn.warehouseId)).limit(1).then((r) => r[0]),
      db
        .select({
          qty: purchaseReceiptLines.quantity,
          rejectedQty: purchaseReceiptLines.rejectedQty,
          batchNo: purchaseReceiptLines.batchNo,
          expiryDate: purchaseReceiptLines.expiryDate,
          code: items.code,
          name: items.nameAr,
        })
        .from(purchaseReceiptLines)
        .leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
        .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id)),
    ]);

    const accepted = lines.reduce((s, l) => s + Number(l.qty ?? 0), 0);
    const rejected = lines.reduce((s, l) => s + Number(l.rejectedQty ?? 0), 0);
    // Only show the batch column when the goods are actually batch-tracked.
    const hasBatch = lines.some((l) => l.batchNo || l.expiryDate);

    return (
      <DocumentSheet
        org={org}
        title="إذن استلام"
        number={grn.number}
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
          { label: "#", width: "5%" },
          { label: "الصنف", width: hasBatch ? "42%" : "62%" },
          ...(hasBatch ? [{ label: "التشغيلة / الصلاحية", width: "20%" }] : []),
          { label: "المستلم", align: "end" as const, width: "16%" },
          { label: "المرفوض", align: "end" as const, width: "17%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
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
        ])}
        totals={rejected > 0 ? [{ label: "إجمالي المرفوض", value: qty(rejected), tone: "danger" as const }] : []}
        balance={{ label: "إجمالي المستلم", value: qty(accepted) }}
        note={grn.notes}
        signatures={["المورّد", "أمين المخزن", "الفحص"]}
      />
    );
  });
}
