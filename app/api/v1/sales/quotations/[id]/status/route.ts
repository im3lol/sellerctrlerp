import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { setQuotationStatusAction } from "@/app/actions/erp/quotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/sales/quotations/:id/status — set status. Body: { status: "SENT"|"ACCEPTED"|"REJECTED" }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "sales.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? "");
  const r = await runAsErp(auth, () => setQuotationStatusAction(id, status));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
