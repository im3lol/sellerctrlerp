import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReturns, purchaseReturnLines, suppliers, items, purchaseInvoices, purchaseReceipts } from "@/db/schema";
import { fmt, qty, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ number: string }> };

const STATUS: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرتجع مُرحّل", CANCELLED: "ملغى" };

export default async function PrintPurchaseReturnPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("purchases.view", async ({ orgId }) => {
    const [ret] = await db
      .select()
      .from(purchaseReturns)
      .where(and(eq(purchaseReturns.number, raw), eq(purchaseReturns.organizationId, orgId)))
      .limit(1);
    if (!ret) notFound();

    const [{ org, currency }, sup, lines, [pi], [grn]] = await Promise.all([
      loadPrintHeader(orgId),
      ret.supplierId
        ? db.select({ nameAr: suppliers.nameAr, phone: suppliers.phone, address: suppliers.address })
            .from(suppliers).where(eq(suppliers.id, ret.supplierId)).limit(1).then((r) => r[0])
        : undefined,
      db
        .select({
          qty: purchaseReturnLines.quantity,
          unitPrice: purchaseReturnLines.unitPrice,
          total: purchaseReturnLines.totalAmount,
          code: items.code,
          name: items.nameAr,
        })
        .from(purchaseReturnLines)
        .leftJoin(items, eq(items.id, purchaseReturnLines.itemId))
        .where(eq(purchaseReturnLines.purchaseReturnId, ret.id)),
      ret.purchaseInvoiceId
        ? db.select({ number: purchaseInvoices.number }).from(purchaseInvoices).where(eq(purchaseInvoices.id, ret.purchaseInvoiceId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
      ret.purchaseReceiptId
        ? db.select({ number: purchaseReceipts.number }).from(purchaseReceipts).where(eq(purchaseReceipts.id, ret.purchaseReceiptId)).limit(1)
        : Promise.resolve([] as { number: string }[]),
    ]);

    return (
      <DocumentSheet
        org={org}
        title="مرتجع شراء"
        number={ret.number}
        backHref={`/purchases/returns/${encodeURIComponent(raw)}`}
        watermark={ret.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(ret.date) },
          { label: "الحالة", value: STATUS[ret.status] ?? ret.status },
          ...(pi ? [{ label: "مرجع الفاتورة", value: pi.number }] : []),
          ...(grn ? [{ label: "إذن الاستلام", value: grn.number }] : []),
        ]}
        parties={sup ? [{
          label: "المورّد",
          name: sup.nameAr,
          lines: [sup.address, sup.phone],
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
