import { runAsErp } from "@/lib/erp/api-auth";
import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { db } from "@/lib/db";
import { purchaseOrders, organizations } from "@/db/schema";
import { tryRecordAudit } from "@/lib/erp/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/orders/:id/confirm — DRAFT → CONFIRMED (respects the PO approval threshold). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  return runAsErp(auth, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number, total: purchaseOrders.totalAmount, approvedAt: purchaseOrders.approvedAt })
      .from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return Response.json({ error: "الأمر غير موجود" }, { status: 404 });
    if (po.status !== "DRAFT") return Response.json({ error: "الأمر مؤكّد بالفعل" }, { status: 400 });

    const [org] = await db.select({ threshold: organizations.poApprovalThreshold }).from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
    const threshold = Number(org?.threshold ?? 0);
    if (threshold > 0 && Number(po.total) > threshold && !po.approvedAt) {
      return Response.json({ error: `القيمة تتجاوز حد الاعتماد (${threshold.toLocaleString("ar-EG")}) — يلزم اعتماده أولاً` }, { status: 400 });
    }

    await db.update(purchaseOrders).set({ status: "CONFIRMED" }).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId)));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `تأكيد أمر شراء ${po.number} (موبايل)` });
    return Response.json({ ok: true });
  });
}
