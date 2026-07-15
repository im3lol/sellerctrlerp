import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { cashBankAccounts } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/accounting/cash-accounts — cash/bank leaf accounts (110x) for payment pickers. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await cashBankAccounts(auth.orgId) });
}
