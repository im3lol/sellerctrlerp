import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { deleteDraftEntryAction } from "@/app/actions/erp/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/accounting/journal/:id/delete — delete a DRAFT entry. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const r = await runAsErp(auth, () => deleteDraftEntryAction(id));
  if (r.error) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ data: { ok: true } });
}
