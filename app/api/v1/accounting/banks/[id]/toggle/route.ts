import { and, eq } from "drizzle-orm";
import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { db } from "@/lib/db";
import { bankAccounts } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/banks/:id/toggle — flip active/inactive. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const [ba] = await db.select({ isActive: bankAccounts.isActive }).from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, auth.orgId)));
  if (!ba) return Response.json({ error: "الحساب البنكي غير موجود" }, { status: 404 });
  await db.update(bankAccounts).set({ isActive: !ba.isActive, updatedAt: new Date() })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, auth.orgId)));
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "BANK_ACCOUNT", id });
  return Response.json({ data: { ok: true } });
}
