import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { purchaseOrders } from "@/db/schema";
import { UUID_RE } from "@/lib/erp/doc-route";

export default async function ReceivePage({ params }: { params: Promise<{ number: string }> }) {
  const raw = (await params).number;
  return loadErpPage("purchases.receive", async ({ orgId }) => {
    const [po] = await db.select({ number: purchaseOrders.number, status: purchaseOrders.status }).from(purchaseOrders)
      .where(and(eq(purchaseOrders.organizationId, orgId), UUID_RE.test(raw) ? eq(purchaseOrders.id, raw) : eq(purchaseOrders.number, raw))).limit(1);
    if (!po) notFound();
    if (!["CONFIRMED", "PARTIALLY_RECEIVED"].includes(po.status)) redirect("/purchases/orders/" + encodeURIComponent(po.number));
    redirect("/purchases/receipts/new?order=" + encodeURIComponent(po.number));
  });
}
