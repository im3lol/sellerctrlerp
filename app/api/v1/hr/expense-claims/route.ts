import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { expenseClaimList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/hr/expense-claims — expense reimbursement claims. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "hr.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await expenseClaimList(auth.orgId) });
}
