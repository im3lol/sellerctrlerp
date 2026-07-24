import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, warehouses } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_RECEIVED: "استلام جزئي",
  RECEIVED: "تم الاستلام", INVOICED: "مفوتر", CANCELLED: "ملغى",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintPurchaseOrderPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [po] = await db
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId)))
      .limit(1);
    if (!po) notFound();

    const [{ org, currency }, supp, wh, lines] = await Promise.all([
      loadPrintHeader(orgId),
      po.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, po.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      po.warehouseId
        ? db.select({ nameAr: warehouses.nameAr }).from(warehouses)
            .where(eq(warehouses.id, po.warehouseId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: purchaseOrderLines.quantity,
          receivedQty: purchaseOrderLines.receivedQty,
          unitPrice: purchaseOrderLines.unitPrice,
          discount: purchaseOrderLines.discountAmount,
          total: purchaseOrderLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(purchaseOrderLines)
        .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
        .where(eq(purchaseOrderLines.purchaseOrderId, po.id)),
    ]);

    const discount = Number(po.discountAmount ?? 0);
    const tax = Number(po.taxAmount ?? 0);

    return (
      <DocumentSheet
        org={org}
        title="أمر شراء"
        number={po.number}
        watermark={po.status === "DRAFT" ? "مسودة" : undefined}
        backHref={`/purchases/orders/${encodeURIComponent(raw)}`}
        // No delivery-date column on purchase orders — only `date`.
        meta={[
          { label: "التاريخ", value: dt(po.date) },
          { label: "الحالة", value: STATUS[po.status] ?? po.status },
        ]}
        parties={[
          ...(supp ? [{ label: "المورّد", name: supp.nameAr, lines: [supp.address, supp.phone] }] : []),
          ...(wh ? [{ label: "التسليم إلى", name: wh.nameAr, lines: [] }] : []),
        ]}
        columns={[
          { label: "#", width: "5%" },
          { label: "الصنف", width: "38%" },
          { label: "الكمية", align: "center", width: "10%" },
          { label: "المستلم", align: "center", width: "10%" },
          { label: "السعر", align: "end", width: "13%" },
          { label: "الخصم", align: "end", width: "10%" },
          { label: "الإجمالي", align: "end", width: "14%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          qty(l.qty),
          <span key="r" style={{ color: "#8a93a6" }}>{qty(l.receivedQty)}</span>,
          fmt(l.unitPrice),
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${money(discount, currency)}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: `الضريبة (${po.taxPercent}%)`, value: money(tax, currency) }] : []),
        ]}
        balance={{ label: "الإجمالي", value: money(po.totalAmount, currency) }}
        note={po.notes}
        signatures={["إعداد", "اعتماد", "المورّد"]}
      />
    );
  });
}
