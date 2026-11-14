import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { purchaseInvoiceDetail } from "@/lib/erp/mobile-lists";
import { canReadPurchaseCosts } from "@/lib/erp/data-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/purchases/invoices/:id — invoice header + lines. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await authorizeApi(req, "purchases.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (!canReadPurchaseCosts(auth.can)) return Response.json({ error: "forbidden" }, { status: 403 });
  const detail = await purchaseInvoiceDetail(auth.orgId, id);
  if (!detail) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: detail });
}
