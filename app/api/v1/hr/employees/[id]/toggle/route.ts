import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { emitErpEvent } from "@/lib/erp/realtime";
import { toggleEmployeeActiveAction } from "@/app/actions/erp/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/hr/employees/:id/toggle — activate/deactivate an employee. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "hr.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => toggleEmployeeActiveAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  emitErpEvent(auth.orgId, { action: "UPDATE", entity: "EMPLOYEE", id });
  return Response.json({ data: { ok: true } });
}
