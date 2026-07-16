import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { budgetForYear } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/budget/:year — budgetable accounts + their amount for the year. */
export async function GET(req: Request, ctx: { params: Promise<{ year: string }> }) {
  const { year } = await ctx.params;
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return Response.json({ error: "سنة غير صالحة" }, { status: 400 });
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: { year: y, lines: await budgetForYear(auth.orgId, y) } });
}
