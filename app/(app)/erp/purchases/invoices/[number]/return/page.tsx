import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseInvoices, purchaseInvoiceLines, items, purchaseReturns, purchaseReturnLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvoiceReturnForm, type ReturnLine } from "@/components/erp/invoice-return-form";
import { UUID_RE } from "@/components/erp/document-detail";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function PurchaseInvoiceReturnPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.create");

  const [inv] = UUID_RE.test(raw)
    ? await db.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.id, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1)
    : await db.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.number, raw), eq(purchaseInvoices.organizationId, orgId))).limit(1);
  if (!inv) notFound();
  const back = `/erp/purchases/invoices/${encodeURIComponent(inv.number)}`;
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") redirect(back);

  const invLines = await db
    .select({ itemId: purchaseInvoiceLines.itemId, quantity: purchaseInvoiceLines.quantity, unitPrice: purchaseInvoiceLines.unitPrice, code: items.code, name: items.nameAr })
    .from(purchaseInvoiceLines).leftJoin(items, eq(items.id, purchaseInvoiceLines.itemId))
    .where(eq(purchaseInvoiceLines.purchaseInvoiceId, inv.id));

  const retRows = await db
    .select({ itemId: purchaseReturnLines.itemId, qty: purchaseReturnLines.quantity })
    .from(purchaseReturnLines)
    .innerJoin(purchaseReturns, eq(purchaseReturns.id, purchaseReturnLines.purchaseReturnId))
    .where(and(eq(purchaseReturns.purchaseInvoiceId, inv.id), eq(purchaseReturns.status, "POSTED")));
  const returnedByItem = new Map<string, number>();
  for (const r of retRows) returnedByItem.set(r.itemId, (returnedByItem.get(r.itemId) ?? 0) + Number(r.qty));

  const byItem = new Map<string, ReturnLine>();
  for (const l of invLines) {
    const cur = byItem.get(l.itemId) ?? { itemId: l.itemId, code: l.code ?? "", name: l.name ?? "", invoiced: 0, returned: 0, remaining: 0, unitPrice: Number(l.unitPrice) };
    cur.invoiced += Number(l.quantity);
    byItem.set(l.itemId, cur);
  }
  const lines = [...byItem.values()].map((c) => {
    const returned = returnedByItem.get(c.itemId) ?? 0;
    return { ...c, returned, remaining: round2(c.invoiced - returned) };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="Undo2" title={`مرتجع مشتريات — ${inv.number}`} subtitle="حدّد كميات المرتجع ثم أكّد — يُسجَّل إشعار مدين ويُرحَّل" backHref={back} />
      <InvoiceReturnForm type="purchase" invoiceId={inv.id} invoiceNumber={inv.number} backHref={back} lines={lines} />
    </div>
  );
}
