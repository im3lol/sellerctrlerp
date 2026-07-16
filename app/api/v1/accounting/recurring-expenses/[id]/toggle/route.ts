import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { toggleRecurringExpenseAction } from "@/app/actions/erp/recurring-expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/recurring-expenses/:id/toggle — pause/resume. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => toggleRecurringExpenseAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "RECURRING_EXPENSE", id });
  return Response.json({ data: { ok: true } });
}
