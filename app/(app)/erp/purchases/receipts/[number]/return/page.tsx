import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseReceipts, purchaseReceiptLines, items, stockMovements, purchaseReturns, purchaseReturnLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvoiceReturnForm, type ReturnLine } from "@/components/erp/invoice-return-form";
import { UUID_RE } from "@/components/erp/document-detail";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function ReceiptReturnPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.create");

  const [grn] = UUID_RE.test(raw)
    ? await db.select().from(purchaseReceipts).where(and(eq(purchaseReceipts.id, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1)
    : await db.select().from(purchaseReceipts).where(and(eq(purchaseReceipts.number, raw), eq(purchaseReceipts.organizationId, orgId))).limit(1);
  if (!grn) notFound();
  const back = `/erp/purchases/receipts/${encodeURIComponent(grn.number)}`;
  if (grn.status !== "RECEIVED" && grn.status !== "INVOICED") redirect(back);

  // Received quantity + item label.
  const recLines = await db
    .select({ itemId: purchaseReceiptLines.itemId, quantity: purchaseReceiptLines.quantity, code: items.code, name: items.nameAr })
    .from(purchaseReceiptLines).leftJoin(items, eq(items.id, purchaseReceiptLines.itemId))
    .where(eq(purchaseReceiptLines.purchaseReceiptId, grn.id));

  // Unit cost at receipt = the stock value added when the GRN was confirmed (WAC IN).
  const moves = await db
    .select({ itemId: stockMovements.itemId, quantity: stockMovements.quantity, unitCost: stockMovements.unitCost })
    .from(stockMovements)
    .where(and(eq(stockMovements.organizationId, orgId), eq(stockMovements.referenceType, "GOODS_RECEIPT"), eq(stockMovements.referenceId, grn.id)));
  const costByItem = new Map<string, { v: number; q: number }>();
  for (const m of moves) {
    const c = costByItem.get(m.itemId) ?? { v: 0, q: 0 };
    c.v += Number(m.quantity) * Number(m.unitCost); c.q += Number(m.quantity);
    costByItem.set(m.itemId, c);
  }

  // Already returned (posted receipt returns for this GRN).
  const retRows = await db
    .select({ itemId: purchaseReturnLines.itemId, qty: purchaseReturnLines.quantity })
    .from(purchaseReturnLines)
    .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnLines.purchaseReturnId))
    .where(and(eq(purchaseReturns.purchaseReceiptId, grn.id), eq(purchaseReturns.status, "POSTED")));
  const returnedByItem = new Map<string, number>();
  for (const r of retRows) returnedByItem.set(r.itemId, (returnedByItem.get(r.itemId) ?? 0) + Number(r.qty));

  const byItem = new Map<string, ReturnLine>();
  for (const l of recLines) {
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
      <ErpPageHeader icon="Undo2" title={`مرتجع إذن استلام — ${grn.number}`} subtitle="حدّد كميات الإرجاع للمخزن ثم احفظ كمسودة وأكّد" backHref={back} />
      <InvoiceReturnForm type="receipt" invoiceId={grn.id} invoiceNumber={grn.number} backHref={back} lines={lines} />
    </div>
  );
}
