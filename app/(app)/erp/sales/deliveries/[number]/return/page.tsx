import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { deliveryNotes, deliveryNoteLines, items, stockMovements, salesReturns, salesReturnLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvoiceReturnForm, type ReturnLine } from "@/components/erp/invoice-return-form";
import { UUID_RE } from "@/components/erp/document-detail";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function DeliveryReturnPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.create");

  const [dn] = UUID_RE.test(raw)
    ? await db.select().from(deliveryNotes).where(and(eq(deliveryNotes.id, raw), eq(deliveryNotes.organizationId, orgId))).limit(1)
    : await db.select().from(deliveryNotes).where(and(eq(deliveryNotes.number, raw), eq(deliveryNotes.organizationId, orgId))).limit(1);
  if (!dn) notFound();
  const back = `/erp/sales/deliveries/${encodeURIComponent(dn.number)}`;
  if (dn.status !== "DELIVERED" && dn.status !== "INVOICED") redirect(back);

  // Delivered quantity + item label.
  const dnLines = await db
    .select({ itemId: deliveryNoteLines.itemId, quantity: deliveryNoteLines.quantity, code: items.code, name: items.nameAr })
    .from(deliveryNoteLines).leftJoin(items, eq(items.id, deliveryNoteLines.itemId))
    .where(eq(deliveryNoteLines.deliveryNoteId, dn.id));

  // Unit cost at delivery = the stock value taken out when the delivery was confirmed (COGS).
  const moves = await db
    .select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceType, "DELIVERY"), eq(stockMovements.referenceId, dn.id)));
  const costByItem = new Map<string, { v: number; q: number }>();
  for (const m of moves) {
    const c = costByItem.get(m.itemId) ?? { v: 0, q: 0 };
    c.v += Number(m.quantity) * Number(m.unitCost); c.q += Number(m.quantity);
    costByItem.set(m.itemId, c);
  }

  // Already returned (posted delivery returns for this note).
  const retRows = await db
    .select({ itemId: salesReturnLines.itemId, qty: salesReturnLines.quantity })
    .from(salesReturnLines)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
    .where(and(eq(salesReturns.deliveryNoteId, dn.id), eq(salesReturns.status, "POSTED")));
  const returnedByItem = new Map<string, number>();
  for (const r of retRows) returnedByItem.set(r.itemId, (returnedByItem.get(r.itemId) ?? 0) + Number(r.qty));

  const byItem = new Map<string, ReturnLine>();
  for (const l of dnLines) {
    const c = costByItem.get(l.itemId);
    const unitPrice = c && c.q > 0 ? round2(c.v / c.q) : 0;
    const cur = byItem.get(l.itemId) ?? { itemId: l.itemId, code: l.code ?? "", name: l.name ?? "", invoiced: 0, returned: 0, remaining: 0, unitPrice };
    cur.invoiced += Number(l.quantity);
    byItem.set(l.itemId, cur);
  }
  const lines = [...byItem.values()].map((c) => {
    const returned = returnedByItem.get(c.itemId) ?? 0;
    return { ...c, returned, remaining: round2(c.invoiced - returned) };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Undo2" title={`مرتجع إذن صرف — ${dn.number}`} subtitle="حدّد كميات الإرجاع للمخزن ثم احفظ كمسودة وأكّد" backHref={back} />
      <InvoiceReturnForm type="delivery" invoiceId={dn.id} invoiceNumber={dn.number} backHref={back} lines={lines} />
    </div>
  );
}
