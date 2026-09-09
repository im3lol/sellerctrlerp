import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items, purchaseReceiptLines, landedCostVouchers, landedCostVoucherLines } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";
import { unitAllIn, round2 } from "@/lib/erp/money";

type Params = { params: Promise<{ number: string }> };

export default async function PrintPurchaseInvoicePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [inv] = await db
      .select()
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId)))
      .limit(1);
    if (!inv) notFound();

    // Import costs and capitalised VAT ride on the goods receipt, not this bill. Shown
    // because this is the document that answers "what did the piece cost", but they are
    // NOT what the supplier is owed — the totals block keeps the two apart.
    const [{ org, currency, hiddenFor, footerText }, supp, lines] = await Promise.all([
      loadPrintHeader(orgId),
      inv.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          itemId: purchaseInvoiceLines.itemId,
          qty: purchaseInvoiceLines.quantity,
          unitPrice: purchaseInvoiceLines.unitPrice,
          shipping: purchaseInvoiceLines.shippingPerUnit,
          discount: purchaseInvoiceLines.discountAmount,
          total: purchaseInvoiceLines.totalAmount,
          code: items.code,
          name: items.nameAr,
          image: items.image,
        })
        .from(purchaseInvoiceLines)
        .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
        .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id)),
    ]);

    const tax = Number(inv.taxAmount ?? 0);
    // The stored subtotal, not total − tax: that derivation silently folded freight and
    // any discount into the goods figure, so an invoice with shipping printed a subtotal
    // that was too high by exactly the freight it never listed.
    const subtotal = Number(inv.subtotal ?? 0);
    const shipping = Number(inv.shippingAmount ?? 0);
    const discount = Number(inv.discountAmount ?? 0);
    const paid = Number(inv.paidAmount ?? 0);

    // Import costs and the VAT the receipt capitalised — both from the goods receipt, the
    // same sources the invoice screen reads, so the sheet and the screen agree.
    const landedByItem = new Map<string, number>();
    const capTaxByItem = new Map<string, number>();
    if (inv.goodsReceiptId) {
      const [lcv, grnLines] = await Promise.all([
        db.select({ itemId: landedCostVoucherLines.itemId, perUnit: landedCostVoucherLines.perUnit })
          .from(landedCostVoucherLines)
          .innerJoin(landedCostVouchers, eq(landedCostVouchers.id, landedCostVoucherLines.voucherId))
          .where(and(
            eq(landedCostVoucherLines.purchaseReceiptId, inv.goodsReceiptId),
            eq(landedCostVouchers.organizationId, orgId),
            eq(landedCostVouchers.status, "POSTED"),
          )),
        db.select({ itemId: purchaseReceiptLines.itemId, taxPerUnit: purchaseReceiptLines.taxPerUnit })
          .from(purchaseReceiptLines).where(eq(purchaseReceiptLines.purchaseReceiptId, inv.goodsReceiptId)),
      ]);
      for (const v of lcv) landedByItem.set(v.itemId, (landedByItem.get(v.itemId) ?? 0) + Number(v.perUnit));
      for (const g of grnLines) capTaxByItem.set(g.itemId, Number(g.taxPerUnit));
    }
    const landedFor = (itemId: string) => landedByItem.get(itemId) ?? 0;
    // Only VAT that was actually capitalised counts as cost; recoverable VAT is an asset.
    const unitCost = (l: { itemId: string; qty: unknown; unitPrice: unknown; shipping: unknown; discount: unknown }) => {
      const q = Number(l.qty ?? 0);
      return unitAllIn({
        quantity: q, unitPrice: Number(l.unitPrice ?? 0), shippingPerUnit: Number(l.shipping ?? 0),
        taxAmount: q * (capTaxByItem.get(l.itemId) ?? 0),
        discountAmount: Number(l.discount ?? 0), landedPerUnit: landedFor(l.itemId),
      });
    };
    const anyLanded = lines.some((l) => Math.abs(landedFor(l.itemId)) > 0.004);
    const landedTotal = round2(lines.reduce((sum, l) => sum + Number(l.qty ?? 0) * landedFor(l.itemId), 0));
    // Sum the rounded row figures so the column and its total cannot disagree by piastres.
    const costTotal = round2(lines.reduce((sum, l) => sum + round2(Number(l.qty ?? 0) * unitCost(l)), 0));

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("purchase-invoice")}
        footerText={footerText}
        title="فاتورة شراء"
        number={inv.number}
        watermark={inv.status === "DRAFT" ? "مسودة" : undefined}
        backHref={`/purchases/invoices/${encodeURIComponent(raw)}`}
        meta={[
          { label: "التاريخ", value: dt(inv.date) },
          ...(inv.dueDate ? [{ label: "الاستحقاق", value: dt(inv.dueDate) }] : []),
        ]}
        parties={supp ? [{
          label: "المورّد",
          name: supp.nameAr,
          lines: [supp.address, supp.phone],
        }] : []}
        columns={[
          { label: "#", width: "4%" },
          // A normal print column, so it can be switched off in the org's print settings.
          { label: "صورة", align: "center", width: "7%" },
          { label: "الصنف", width: anyLanded ? "24%" : "31%" },
          { label: "الكمية", align: "center", width: "8%" },
          { label: "السعر", align: "end", width: "11%" },
          { label: "شحن/وحدة", align: "end", width: "10%" },
          { label: "الخصم", align: "end", width: "9%" },
          ...(anyLanded ? [{ label: "تكاليف استيراد/وحدة", align: "end" as const, width: "13%" }] : []),
          { label: "تكلفة القطعة", align: "end" as const, width: "11%" },
          { label: "الإجمالي", align: "end", width: "11%" },
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
          qty(l.qty),
          fmt(l.unitPrice),
          Number(l.shipping ?? 0) > 0 ? fmt(l.shipping) : "—",
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          ...(anyLanded ? [landedFor(l.itemId) > 0 ? fmt(landedFor(l.itemId)) : "—"] : []),
          <b key="u">{fmt(unitCost(l))}</b>,
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
          // Charge lines appear only when they carry a value.
          ...(shipping > 0 ? [{ label: "الشحن", value: money(shipping, currency) }] : []),
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${money(discount, currency)}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: `ضريبة المدخلات (${inv.taxPercent}%)`, value: money(tax, currency) }] : []),
          { label: "إجمالي الفاتورة (المستحق للمورد)", value: money(inv.totalAmount, currency), tone: "strong" as const },
          // Import costs are owed to somebody else on another document, so the goods'
          // full cost and the supplier's bill are deliberately different figures.
          ...(anyLanded ? [
            { label: "تكاليف استيراد محمَّلة", value: money(landedTotal, currency) },
            { label: "التكلفة الشاملة للبضاعة", value: money(costTotal, currency), tone: "strong" as const },
          ] : []),
          ...(paid > 0 ? [{ label: "المسدَّد", value: `− ${money(paid, currency)}`, tone: "success" as const }] : []),
        ]}
        balance={{ label: "المتبقّي", value: money(inv.balanceDue, currency) }}
        note={inv.notes}
        signatures={["إعداد", "مراجعة", "اعتماد"]}
      />
    );
  });
}
