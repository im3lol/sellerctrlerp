import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { confirmPayrollRunAction } from "@/app/actions/erp/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/hr/payroll/:id/confirm — DRAFT → POSTED (books the payroll journal). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "hr.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => confirmPayrollRunAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
