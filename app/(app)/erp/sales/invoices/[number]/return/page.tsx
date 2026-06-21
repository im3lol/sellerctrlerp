import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesInvoices, salesInvoiceLines, items, salesReturns, salesReturnLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { InvoiceReturnForm, type ReturnLine } from "@/components/erp/invoice-return-form";
import { UUID_RE } from "@/components/erp/document-detail";

const round2 = (n: number) => Math.round(n * 100) / 100;

export default async function SalesInvoiceReturnPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("sales.create");

  const [inv] = UUID_RE.test(raw)
    ? await db.select().from(salesInvoices).where(and(eq(salesInvoices.id, raw), eq(salesInvoices.organizationId, orgId))).limit(1)
    : await db.select().from(salesInvoices).where(and(eq(salesInvoices.number, raw), eq(salesInvoices.organizationId, orgId))).limit(1);
  if (!inv) notFound();
  const back = `/erp/sales/invoices/${encodeURIComponent(inv.number)}`;
  if (inv.status === "DRAFT" || inv.status === "CANCELLED") redirect(back);

  const invLines = await db
    .select({ itemId: salesInvoiceLines.itemId, quantity: salesInvoiceLines.quantity, unitPrice: salesInvoiceLines.unitPrice, code: items.code, name: items.nameAr })
    .from(salesInvoiceLines).leftJoin(items, eq(items.id, salesInvoiceLines.itemId))
    .where(eq(salesInvoiceLines.salesInvoiceId, inv.id));

  // Already-returned quantity per item (posted returns against this invoice).
  const retRows = await db
    .select({ itemId: salesReturnLines.itemId, qty: salesReturnLines.quantity })
    .from(salesReturnLines)
    .innerJoin(salesReturns, eq(salesReturns.id, salesReturnLines.salesReturnId))
    .where(and(eq(salesReturns.salesInvoiceId, inv.id), eq(salesReturns.status, "POSTED")));
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
      <ErpPageHeader icon="Undo2" title={`مرتجع مبيعات — ${inv.number}`} subtitle="حدّد كميات المرتجع ثم أكّد — يُسجَّل إشعار دائن ويُرحَّل" backHref={back} />
      <InvoiceReturnForm type="sales" invoiceId={inv.id} invoiceNumber={inv.number} backHref={back} lines={lines} />
    </div>
  );
}
