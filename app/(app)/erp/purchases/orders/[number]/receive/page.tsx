import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderLines, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FulfillmentForm, type FulfillLine } from "@/components/erp/fulfillment-form";
import { UUID_RE } from "@/components/erp/document-detail";

const r3 = (n: number) => Math.max(0, Math.round(n * 1000) / 1000);

export default async function ReceivePage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  const { orgId } = await requireErpModule("purchases.confirm");

  const [po] = UUID_RE.test(raw)
    ? await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, raw), eq(purchaseOrders.organizationId, orgId))).limit(1)
    : await db.select().from(purchaseOrders).where(and(eq(purchaseOrders.number, raw), eq(purchaseOrders.organizationId, orgId))).limit(1);
  if (!po) notFound();
  const back = `/erp/purchases/orders/${encodeURIComponent(po.number)}`;
  if (po.status !== "CONFIRMED" && po.status !== "PARTIALLY_RECEIVED") redirect(back);

  const rows = await db
    .select({ itemId: purchaseOrderLines.itemId, ordered: purchaseOrderLines.quantity, received: purchaseOrderLines.receivedQty, code: items.code, name: items.nameAr })
    .from(purchaseOrderLines).leftJoin(items, eq(items.id, purchaseOrderLines.itemId)).where(eq(purchaseOrderLines.purchaseOrderId, po.id));
  const lines: FulfillLine[] = rows.map((r) => {
    const ordered = Number(r.ordered), fulfilled = Number(r.received);
    return { itemId: r.itemId, code: r.code ?? "", name: r.name ?? "", ordered, fulfilled, remaining: r3(ordered - fulfilled) };
  });

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="PackageCheck" title={`استلام أمر شراء ${po.number}`} subtitle="إذن استلام — استلام كامل أو جزئي" backHref={back} />
      <FulfillmentForm type="receipt" orderId={po.id} lines={lines} dest={back} />
    </div>
  );
}
