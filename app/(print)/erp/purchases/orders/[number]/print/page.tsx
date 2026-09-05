import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, suppliers, items, warehouses } from "@/db/schema";
import { fmt, qty, dt } from "@/lib/erp/print-format";
import { getBaseCurrencyCode } from "@/lib/erp/currency";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

/** Rates are stored to 6dp; rounding them on a printed document hides the real figure. */
const rate6 = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 6 });

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
          shippingPerUnit: purchaseOrderLines.shippingPerUnit,
          discount: purchaseOrderLines.discountAmount,
          tax: purchaseOrderLines.taxAmount,
          total: purchaseOrderLines.totalAmount,
          code: items.code,
          name: items.nameAr,
          image: items.image,
        })
        .from(purchaseOrderLines)
        .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
        .where(eq(purchaseOrderLines.purchaseOrderId, po.id)),
    ]);

    // Everything is stored in base (EGP). A foreign order was entered in its own currency,
    // so the printed sheet has to show BOTH: the figure the buyer agreed with the supplier,
    // and the figure the books carry — with the rate that connects them. Printing one
    // without the other is what makes a reader think a converted number is the original.
    const baseCode = await getBaseCurrencyCode(orgId);
    const docRate = Number(po.exchangeRate) || 1;
    const cur = (po.currencyCode ?? baseCode) || baseCode;
    const isForeign = cur.toUpperCase() !== baseCode.toUpperCase() && docRate > 0;
    /** base → the order's own currency */
    const d = (v: string | number | null) => Number(v ?? 0) / docRate;
    const b = (v: string | number | null) => Number(v ?? 0);
    const subtotal = Number(po.subtotal ?? 0);
    const shipping = Number(po.shippingAmount ?? 0);
    const discount = Number(po.discountAmount ?? 0);
    const tax = Number(po.taxAmount ?? 0);
    // Column labels are the key the org's print-column settings hide by, so a domestic
    // order keeps EXACTLY the labels it had — the currency suffix only appears where it
    // resolves a real ambiguity, on a foreign order showing two currencies at once.
    const cx = (label: string) => (isForeign ? `${label} (${cur})` : label);
    const anyDiscount = lines.some((l) => Number(l.discount ?? 0) > 0);
    const anyShipping = lines.some((l) => Number(l.shippingPerUnit ?? 0) > 0);

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
          // The rate is part of the document, not a detail: every base figure below is
          // this multiplication, and a reader must be able to redo it.
          ...(isForeign ? [
            { label: "العملة", value: cur },
            { label: "سعر الصرف", value: `١ ${cur} = ${rate6(docRate)} ${baseCode}` },
            { label: "مصدر السعر", value: po.rateSource === "MANUAL" ? "يدوي" : `سعر ${dt(po.date)}` },
          ] : []),
        ]}
        parties={[
          ...(supp ? [{ label: "المورّد", name: supp.nameAr, lines: [supp.address, supp.phone] }] : []),
          ...(wh ? [{ label: "التسليم إلى", name: wh.nameAr, lines: [] }] : []),
        ]}
        columns={[
          { label: "#", width: "4%" },
          // Sits in the org's print-column settings like any other, so a tenant that does
          // not want pictures on paper can switch it off without a code change.
          { label: "صورة", align: "center", width: "7%" },
          { label: "الصنف", width: isForeign ? "26%" : "36%" },
          { label: "الكمية", align: "center", width: "9%" },
          { label: cx("السعر"), align: "end", width: isForeign ? "13%" : "18%" },
          ...(anyShipping ? [{ label: cx("شحن/وحدة"), align: "end" as const, width: "12%" }] : []),
          ...(anyDiscount ? [{ label: cx("الخصم"), align: "end" as const, width: "10%" }] : []),
          { label: cx("الإجمالي"), align: "end", width: isForeign ? "13%" : "16%" },
          // The same line in pounds — shipping included, because that is what the books
          // and the stock valuation will carry.
          ...(isForeign ? [{ label: `الإجمالي (${baseCode})`, align: "end" as const, width: "14%" }] : []),
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
          ...(anyShipping ? [Number(l.shippingPerUnit ?? 0) > 0 ? fmt(d(l.shippingPerUnit)) : "—"] : []),
          ...(anyDiscount ? [Number(l.discount ?? 0) > 0 ? fmt(d(l.discount)) : "—"] : []),
          <b key="t">{fmt(d(l.total))}</b>,
          ...(isForeign ? [<b key="tb">{fmt(b(l.total))}</b>] : []),
        ])}
        // Every charge line appears only when it carries a value — a printed order should
        // not list "الجمارك 0" next to a real shipping figure. Shipping was missing from
        // this list entirely, so an order with freight printed a total that its own rows
        // did not add up to.
        totals={[
          { label: "الإجمالي الفرعي", value: `${fmt(d(subtotal))} ${cur}` },
          ...(shipping > 0 ? [{ label: "الشحن الداخلي", value: `${fmt(d(shipping))} ${cur}` }] : []),
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${fmt(d(discount))} ${cur}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: `الضريبة (${po.taxPercent}%)`, value: `${fmt(d(tax))} ${cur}` }] : []),
          ...(isForeign ? [
            { label: `الإجمالي شامل الشحن (${cur})`, value: `${fmt(d(po.totalAmount))} ${cur}` },
            { label: "سعر الصرف المعتمد", value: `١ ${cur} = ${rate6(docRate)} ${baseCode}` },
          ] : []),
        ]}
        balance={isForeign
          ? { label: `الإجمالي بالـ${baseCode} (شامل الشحن)`, value: `${fmt(b(po.totalAmount))} ${baseCode}` }
          : { label: `الإجمالي (${cur})`, value: `${fmt(d(po.totalAmount))} ${cur}` }}
        note={po.notes}
        signatures={["إعداد", "اعتماد", "المورّد"]}
      />
    );
  });
}
