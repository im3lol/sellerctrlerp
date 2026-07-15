import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { confirmExpenseAction } from "@/app/actions/erp/expenses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/expenses/:id/confirm — DRAFT → POSTED (Dr expense · Cr cash/bank). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.post");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => confirmExpenseAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
