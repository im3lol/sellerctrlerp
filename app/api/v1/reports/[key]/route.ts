import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { salesByCustomer, salesByItem, purchasesBySupplier, purchasesByItem, type RankReport } from "@/lib/erp/mobile-reports";
import type { ErpPermission } from "@/lib/erp/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRY: Record<string, { perm: ErpPermission; fn: (orgId: string, from?: string, to?: string) => Promise<RankReport> }> = {
  "sales-customers": { perm: "sales.view", fn: salesByCustomer },
  "sales-items": { perm: "sales.view", fn: salesByItem },
  "purchases-suppliers": { perm: "purchases.view", fn: purchasesBySupplier },
  "purchases-items": { perm: "purchases.view", fn: purchasesByItem },
};

/** GET /api/v1/reports/:key?from&to — a ranked sales/purchases report. */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const entry = REGISTRY[key];
  if (!entry) return Response.json({ error: "unknown_report" }, { status: 404 });
  const auth = await authorizeApi(req, entry.perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const sp = new URL(req.url).searchParams;
  return Response.json({ data: await entry.fn(auth.orgId, sp.get("from") || undefined, sp.get("to") || undefined) });
}
