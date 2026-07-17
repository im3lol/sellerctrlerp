import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { deliveryNotes, deliveryNoteLines, customers, items, warehouses } from "@/db/schema";
import { qty, dt } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", DELIVERED: "تم التسليم", INVOICED: "مفوتر", REVERSED: "مرتجع",
};

type Params = { params: Promise<{ number: string }> };

/**
 * إذن الصرف — the paper that travels with the goods.
 *
 * Deliberately carries no prices: it's a stock document, and it ends up in the hands
 * of a driver and whoever signs for the delivery. Neither needs to see what the
 * customer paid.
 */
export default async function PrintDeliveryNotePage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.view");

  const [dn] = await db
    .select()
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.number, raw), eq(deliveryNotes.organizationId, orgId)))
    .limit(1);
  if (!dn) notFound();

  const [{ org }, cust, wh, lines] = await Promise.all([
    loadPrintHeader(orgId),
    dn.customerId
      ? db.select({ nameAr: customers.nameAr, phone: customers.phone, address: customers.address })
          .from(customers).where(eq(customers.id, dn.customerId)).limit(1).then((r) => r[0])
      : undefined,
    db.select({ nameAr: warehouses.nameAr }).from(warehouses)
      .where(eq(warehouses.id, dn.warehouseId)).limit(1).then((r) => r[0]),
    db
      .select({
        qty: deliveryNoteLines.quantity,
        code: items.code,
        name: items.nameAr,
      })
      .from(deliveryNoteLines)
      .leftJoin(items, eq(items.id, deliveryNoteLines.itemId))
      .where(eq(deliveryNoteLines.deliveryNoteId, dn.id)),
  ]);

  const totalQty = lines.reduce((s, l) => s + Number(l.qty ?? 0), 0);

  return (
    <DocumentSheet
      org={org}
      title="إذن صرف"
      number={dn.number}
      backHref={`/erp/sales/deliveries/${encodeURIComponent(raw)}`}
      meta={[
        { label: "التاريخ", value: dt(dn.date) },
        { label: "الحالة", value: STATUS[dn.status] ?? dn.status },
      ]}
      parties={[
        ...(cust ? [{ label: "التسليم إلى", name: cust.nameAr, lines: [cust.address, cust.phone] }] : []),
        ...(wh ? [{ label: "الصرف من", name: wh.nameAr, lines: [] }] : []),
      ]}
      columns={[
        { label: "#", width: "6%" },
        { label: "الصنف", width: "64%" },
        { label: "الكمية", align: "end", width: "30%" },
      ]}
      rows={lines.map((l, i) => [
        <span key="i" style={{ color: "#8a93a6" }}>{i + 1}</span>,
        <span key="n">
          <b>{l.name}</b>
          {l.code && <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineStart: 6 }}>{l.code}</span>}
        </span>,
        <b key="q">{qty(l.qty)}</b>,
      ])}
      balance={{ label: "إجمالي الكمية", value: qty(totalQty) }}
      note={dn.notes}
      signatures={["أمين المخزن", "المندوب", "المستلم"]}
    />
  );
}
