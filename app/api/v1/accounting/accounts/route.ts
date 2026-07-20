import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { leafAccounts } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/accounts?type=EXPENSE — postable leaf accounts for pickers. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "accounting.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const type = new URL(req.url).searchParams.get("type") || undefined;
  return Response.json({ data: await leafAccounts(auth.orgId, type) });
}
