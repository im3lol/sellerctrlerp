import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { db } from "@/lib/db";
import { salesOrders } from "@/db/schema";
import { tryRecordAudit } from "@/lib/erp/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales/orders/:id/confirm — DRAFT → CONFIRMED. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });

  const [so] = await db.select({ status: salesOrders.status, number: salesOrders.number }).from(salesOrders)
    .where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId))).limit(1);
  if (!so) return Response.json({ error: "الأمر غير موجود" }, { status: 404 });
  if (so.status !== "DRAFT") return Response.json({ error: "الأمر مؤكّد بالفعل" }, { status: 400 });

  await db.update(salesOrders).set({ status: "CONFIRMED" }).where(and(eq(salesOrders.id, id), eq(salesOrders.organizationId, auth.orgId)));
  await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CONFIRM", entityType: "SALES_ORDER", entityId: id, entityNumber: so.number, summary: `تأكيد أمر بيع ${so.number} (موبايل)` });
  return Response.json({ ok: true });
}
