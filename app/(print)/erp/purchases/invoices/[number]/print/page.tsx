import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, suppliers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

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

    const [{ org, currency }, supp, lines] = await Promise.all([
      loadPrintHeader(orgId),
      inv.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, inv.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: purchaseInvoiceLines.quantity,
          unitPrice: purchaseInvoiceLines.unitPrice,
          shipping: purchaseInvoiceLines.shippingPerUnit,
          discount: purchaseInvoiceLines.discountAmount,
          total: purchaseInvoiceLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(purchaseInvoiceLines)
        .leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
        .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id)),
    ]);

    const tax = Number(inv.taxAmount ?? 0);
    const subtotal = Number(inv.totalAmount) - tax;
    const paid = Number(inv.paidAmount ?? 0);

    return (
      <DocumentSheet
        org={org}
        title="فاتورة شراء"
        number={inv.number}
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
          { label: "#", width: "5%" },
          { label: "الصنف", width: "38%" },
          { label: "الكمية", align: "center", width: "10%" },
          { label: "السعر", align: "end", width: "13%" },
          { label: "شحن/وحدة", align: "end", width: "12%" },
          { label: "الخصم", align: "end", width: "10%" },
          { label: "الإجمالي", align: "end", width: "12%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          qty(l.qty),
          fmt(l.unitPrice),
          Number(l.shipping ?? 0) > 0 ? fmt(l.shipping) : "—",
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
          ...(tax > 0 ? [{ label: `ضريبة المدخلات (${inv.taxPercent}%)`, value: money(tax, currency) }] : []),
          { label: "الإجمالي", value: money(inv.totalAmount, currency), tone: "strong" as const },
          ...(paid > 0 ? [{ label: "المسدَّد", value: `− ${money(paid, currency)}`, tone: "success" as const }] : []),
        ]}
        balance={{ label: "المتبقّي", value: money(inv.balanceDue, currency) }}
        note={inv.notes}
        signatures={["إعداد", "مراجعة", "اعتماد"]}
      />
    );
  });
}
