import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { salesOrders, salesOrderLines, items } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FulfillmentForm, type FulfillLine } from "@/components/erp/fulfillment-form";
import { marketplaceCodesFor } from "@/lib/erp/marketplace-code";
import { UUID_RE } from "@/components/erp/document-detail";

const r3 = (n: number) => Math.max(0, Math.round(n * 1000) / 1000);

export default async function DeliverPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("sales.confirm", async ({ orgId }) => {
    const [so] = UUID_RE.test(raw)
      ? await db.select().from(salesOrders).where(and(eq(salesOrders.id, raw), eq(salesOrders.organizationId, orgId))).limit(1)
      : await db.select().from(salesOrders).where(and(eq(salesOrders.number, raw), eq(salesOrders.organizationId, orgId))).limit(1);
    if (!so) notFound();
    const back = `/sales/orders/${encodeURIComponent(so.number)}`;
    if (so.status !== "CONFIRMED" && so.status !== "PARTIALLY_DELIVERED") redirect(back);

    const rows = await db
      .select({ itemId: salesOrderLines.itemId, ordered: salesOrderLines.quantity, delivered: salesOrderLines.deliveredQty, code: items.code, name: items.nameAr })
      .from(salesOrderLines).leftJoin(items, eq(items.id, salesOrderLines.itemId)).where(eq(salesOrderLines.salesOrderId, so.id));
    const mkt = await marketplaceCodesFor(orgId, so.channel, rows.map((r) => r.itemId));
    const lines: FulfillLine[] = rows.map((r) => {
      const ordered = Number(r.ordered), fulfilled = Number(r.delivered);
      return { itemId: r.itemId, code: r.code ?? "", name: r.name ?? "", ordered, fulfilled, remaining: r3(ordered - fulfilled), marketplaceCode: mkt.get(r.itemId) };
    });

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Truck" title={`تسليم أمر بيع ${so.number}`} subtitle="إذن صرف — تسليم كامل أو جزئي" backHref={back} />
        <FulfillmentForm type="delivery" orderId={so.id} lines={lines} dest={back} channel={so.channel} />
      </div>
    );
  });
}
