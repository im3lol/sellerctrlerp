import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, warehouses } from "@/db/schema";
import { fmt, qty, dt } from "@/lib/erp/print-format";
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

    const [{ org, hiddenFor, footerText }, supp, wh, lines] = await Promise.all([
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
          unitPrice: purchaseOrderLines.unitPrice,
          discount: purchaseOrderLines.discountAmount,
          total: purchaseOrderLines.totalAmount,
          code: items.code,
          name: items.nameAr,
          image: items.image,
        })
        .from(purchaseOrderLines)
        .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
        .where(eq(purchaseOrderLines.purchaseOrderId, po.id)),
    ]);

    // Purchase orders are printed in the currency they were entered in; the ledger stores
    // base (EGP), so divide stored base amounts by the rate for display.
    const docRate = Number(po.exchangeRate) || 1;
    const cur = po.currencyCode ?? "";
    const d = (v: string | number | null) => Number(v ?? 0) / docRate;
    const subtotal = Number(po.subtotal ?? 0);
    const shipping = Number(po.shippingAmount ?? 0);
    const discount = Number(po.discountAmount ?? 0);
    const tax = Number(po.taxAmount ?? 0);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("purchase-order")}
        footerText={footerText}
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
          // Sits in the org's print-column settings like any other, so a tenant that does
          // not want pictures on paper can switch it off without a code change.
          { label: "صورة", align: "center", width: "9%" },
          { label: "الصنف", width: "36%" },
          { label: "الكمية", align: "center", width: "12%" },
          { label: `السعر (${cur})`, align: "end", width: "18%" },
          { label: "الخصم", align: "end", width: "10%" },
          { label: "الإجمالي", align: "end", width: "16%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          // Fixed box + object-fit so a tall or wide picture cannot stretch the row, and
          // nothing at all when the item has no image — a page of placeholder icons is
          // noise on paper. Deliberately not lazy: a lazy image below the fold can still
          // be unloaded when the print dialog snapshots the page.
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
          qty(l.qty),
          fmt(d(l.unitPrice)),
          Number(l.discount ?? 0) > 0 ? fmt(d(l.discount)) : "—",
          <b key="t">{fmt(d(l.total))}</b>,
        ])}
        // Every charge line appears only when it carries a value — a printed order should
        // not list "الجمارك 0" next to a real shipping figure. Shipping was missing from
        // this list entirely, so an order with freight printed a total that its own rows
        // did not add up to.
        totals={[
          { label: "الإجمالي الفرعي", value: `${fmt(d(subtotal))} ${cur}` },
          ...(shipping > 0 ? [{ label: "الشحن", value: `${fmt(d(shipping))} ${cur}` }] : []),
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${fmt(d(discount))} ${cur}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: `الضريبة (${po.taxPercent}%)`, value: `${fmt(d(tax))} ${cur}` }] : []),
        ]}
        balance={{ label: `الإجمالي (${cur})`, value: `${fmt(d(po.totalAmount))} ${cur}` }}
        note={po.notes}
        signatures={["إعداد", "اعتماد", "المورّد"]}
      />
    );
  });
}
