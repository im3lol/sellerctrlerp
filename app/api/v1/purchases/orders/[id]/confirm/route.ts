import { runAsErp } from "@/lib/erp/api-auth";
import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { db } from "@/lib/db";
import { purchaseOrders } from "@/db/schema";
import { tryRecordAudit } from "@/lib/erp/audit";
import { approvalGate } from "@/lib/erp/approvals";
import { catalogFromOrder } from "@/lib/erp/supplier-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/purchases/orders/:id/confirm — DRAFT → CONFIRMED (goes to a manager above the approval threshold). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  return runAsErp(auth, async () => {
    const [po] = await db.select({ status: purchaseOrders.status, number: purchaseOrders.number, total: purchaseOrders.totalAmount })
      .from(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId))).limit(1);
    if (!po) return Response.json({ error: "الأمر غير موجود" }, { status: 404 });
    if (po.status !== "DRAFT") return Response.json({ error: "الأمر مؤكّد بالفعل" }, { status: 400 });

    const total = Number(po.total);
    const gate = await approvalGate({ orgId: auth.orgId, userId: auth.userId, role: auth.role, entityId: id, entityNumber: po.number, amount: total, facts: { docType: "PURCHASE_ORDER", total } });
    if ("error" in gate) return Response.json({ error: gate.error, pendingApproval: true }, { status: 409 });

    await db.update(purchaseOrders).set({ status: "CONFIRMED" })
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, auth.orgId), eq(purchaseOrders.status, "DRAFT")));
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "PURCHASE_ORDER", entityId: id, entityNumber: po.number, summary: `تأكيد أمر شراء ${po.number} (موبايل)` });
    await catalogFromOrder(auth.orgId, id);
    return Response.json({ ok: true });
  });
}
