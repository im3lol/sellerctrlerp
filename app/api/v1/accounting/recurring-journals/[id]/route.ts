import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { recurringJournalDetail } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/recurring-journals/:id — template + its Dr/Cr lines. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const detail = await recurringJournalDetail(auth.orgId, id);
  if (!detail) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: detail });
}
