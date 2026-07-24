import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, customers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ number: string }> };

export default async function PrintSalesInvoicePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [inv] = await db
      .select()
      .from(salesInvoices)
      .where(and(eq(salesInvoices.number, raw), eq(salesInvoices.organizationId, orgId)))
      .limit(1);
    if (!inv) notFound();

    const [{ org, currency }, cust, lines] = await Promise.all([
      loadPrintHeader(orgId),
      inv.customerId
        ? db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
            .from(customers).where(eq(customers.id, inv.customerId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: salesInvoiceLines.quantity,
          unitPrice: salesInvoiceLines.unitPrice,
          discount: salesInvoiceLines.discountAmount,
          total: salesInvoiceLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(salesInvoiceLines)
        .leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
        .where(eq(salesInvoiceLines.salesInvoiceId, inv.id)),
    ]);

    const tax = Number(inv.taxAmount ?? 0);
    const shipping = Number(inv.shippingAmount ?? 0);
    const subtotal = Number(inv.totalAmount) - tax - shipping;
    const paid = Number(inv.paidAmount ?? 0);

    return (
      <DocumentSheet
        org={org}
        title="فاتورة بيع"
        number={inv.number}
        watermark={inv.status === "DRAFT" ? "مسودة" : undefined}
        backHref={`/sales/invoices/${encodeURIComponent(raw)}`}
        meta={[
          { label: "التاريخ", value: dt(inv.date) },
          ...(inv.dueDate ? [{ label: "الاستحقاق", value: dt(inv.dueDate) }] : []),
        ]}
        parties={cust ? [{
          label: "فاتورة إلى",
          name: cust.nameAr,
          lines: [cust.address, cust.phone],
        }] : []}
        columns={[
          { label: "#", width: "5%" },
          { label: "الصنف", width: "42%" },
          { label: "الكمية", align: "center", width: "10%" },
          { label: "السعر", align: "end", width: "14%" },
          { label: "الخصم", align: "end", width: "12%" },
          { label: "الإجمالي", align: "end", width: "17%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          qty(l.qty),
          fmt(l.unitPrice),
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          { label: "الإجمالي الفرعي", value: money(subtotal, currency) },
          ...(shipping > 0 ? [{ label: "الشحن", value: money(shipping, currency) }] : []),
          ...(tax > 0 ? [{ label: `ضريبة القيمة المضافة (${inv.taxPercent}%)`, value: money(tax, currency) }] : []),
          { label: "الإجمالي", value: money(inv.totalAmount, currency), tone: "strong" as const },
          ...(paid > 0 ? [{ label: "المدفوع", value: `− ${money(paid, currency)}`, tone: "success" as const }] : []),
        ]}
        balance={{ label: "المتبقّي", value: money(inv.balanceDue, currency) }}
        note={inv.notes}
      />
    );
  });
}
