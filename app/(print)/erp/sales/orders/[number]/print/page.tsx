import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, customers, items } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", PARTIALLY_DELIVERED: "تسليم جزئي",
  DELIVERED: "تم التسليم", INVOICED: "مفوتر", CANCELLED: "ملغى",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintSalesOrderPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [so] = await db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId)))
      .limit(1);
    if (!so) notFound();

    const [{ org, currency }, cust, lines] = await Promise.all([
      loadPrintHeader(orgId),
      so.customerId
        ? db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address, email: customers.email })
            .from(customers).where(eq(customers.id, so.customerId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: salesOrderLines.quantity,
          deliveredQty: salesOrderLines.deliveredQty,
          unitPrice: salesOrderLines.unitPrice,
          discount: salesOrderLines.discountAmount,
          total: salesOrderLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(salesOrderLines)
        .leftJoin(items, eq(items.id, salesOrderLines.itemId))
        .where(eq(salesOrderLines.salesOrderId, so.id)),
    ]);

    const discount = Number(so.discountAmount ?? 0);
    const tax = Number(so.taxAmount ?? 0);

    return (
      <DocumentSheet
        org={org}
        title="أمر بيع"
        number={so.number}
        backHref={`/erp/sales/orders/${encodeURIComponent(raw)}`}
        meta={[
          { label: "التاريخ", value: dt(so.date) },
          ...(so.dueDate ? [{ label: "التسليم", value: dt(so.dueDate) }] : []),
          { label: "الحالة", value: STATUS[so.status] ?? so.status },
        ]}
        parties={cust ? [{
          label: "العميل",
          name: cust.nameAr,
          lines: [cust.address, cust.phone, cust.email],
        }] : []}
        columns={[
          { label: "#", width: "5%" },
          { label: "الصنف", width: "38%" },
          { label: "الكمية", align: "center", width: "10%" },
          { label: "المُسلَّم", align: "center", width: "10%" },
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
          <span key="d" style={{ color: "#8a93a6" }}>{qty(l.deliveredQty)}</span>,
          fmt(l.unitPrice),
          Number(l.discount ?? 0) > 0 ? fmt(l.discount) : "—",
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          ...(discount > 0 ? [{ label: "الخصم", value: `− ${money(discount, currency)}`, tone: "danger" as const }] : []),
          ...(tax > 0 ? [{ label: `الضريبة (${so.taxPercent}%)`, value: money(tax, currency) }] : []),
        ]}
        balance={{ label: "الإجمالي", value: money(so.totalAmount, currency) }}
        note={so.notes}
        signatures={["إعداد", "اعتماد", "العميل"]}
      />
    );
  });
}
