import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { reversePayrollRunAction } from "@/app/actions/erp/payroll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/hr/payroll/:id/reverse — reverse a POSTED run. Body: { reason }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "hr.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();
  if (!reason) return Response.json({ error: "سبب العكس مطلوب" }, { status: 400 });
  const r = await runAsErp(auth, () => reversePayrollRunAction(id, reason));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
