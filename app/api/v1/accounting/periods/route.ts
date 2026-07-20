import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { fiscalPeriodList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/periods — fiscal periods with their status. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await fiscalPeriodList(auth.orgId) });
}
