import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesReturns, salesReturnLines, customers, items, salesInvoices, deliveryNotes } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ number: string }> };

const STATUS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرتجع مُرحّل", CANCELLED: "ملغى" };

export default async function PrintSalesReturnPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.view", async ({ orgId }) => {
    const [ret] = await db
      .select()
      .from(salesReturns)
      .where(and(eq(salesReturns.number, raw), eq(salesReturns.organizationId, orgId)))
      .limit(1);
    if (!ret) notFound();

    const [{ org, currency, hiddenFor, footerText }, cust, lines, [si], [dn]] = await Promise.all([
      loadPrintHeader(orgId),
      ret.customerId
        ? db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
            .from(customers).where(eq(customers.id, ret.customerId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: salesReturnLines.quantity,
          unitPrice: salesReturnLines.unitPrice,
          total: salesReturnLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(salesReturnLines)
        .leftJoin(items, eq(items.id, salesReturnLines.itemId))
        .where(eq(salesReturnLines.salesReturnId, ret.id)),
      ret.salesInvoiceId
        ? db.select({ number: salesInvoices.number }).from(salesInvoices).where(eq(salesInvoices.id, ret.salesInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      ret.deliveryNoteId
        ? db.select({ number: deliveryNotes.number }).from(deliveryNotes).where(eq(deliveryNotes.id, ret.deliveryNoteId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
    ]);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("sales-return")}
        footerText={footerText}
        title="مرتجع بيع"
        number={ret.number}
        backHref={`/sales/returns/${encodeURIComponent(raw)}`}
        watermark={ret.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(ret.date) },
          { label: "الحالة", value: STATUS[ret.status] ?? ret.status },
          ...(si ? [{ label: "مرجع الفاتورة", value: si.number }] : []),
          ...(dn ? [{ label: "إذن الصرف", value: dn.number }] : []),
        ]}
        parties={cust ? [{
          label: "العميل",
          name: cust.nameAr,
          lines: [cust.address, cust.phone],
        }] : []}
        columns={[
          { label: "#", width: "5%" },
          { label: "الصنف", width: "50%" },
          { label: "الكمية", align: "center", width: "12%" },
          { label: "السعر", align: "end", width: "15%" },
          { label: "الإجمالي", align: "end", width: "18%" },
        ]}
        rows={lines.map((l, i) => [
          <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
          <span key="n">
            <b>{l.name}</b>
            {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
          </span>,
          qty(l.qty),
          fmt(l.unitPrice),
          <b key="t">{fmt(l.total)}</b>,
        ])}
        totals={[
          { label: "الإجمالي", value: money(ret.totalAmount, currency), tone: "strong" as const },
        ]}
        note={ret.notes}
      />
    );
  });
}
