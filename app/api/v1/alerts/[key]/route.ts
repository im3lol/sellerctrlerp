import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { reorderAlerts, deadStockAlerts, expiryAlerts } from "@/lib/erp/mobile-alerts";
import type { DocRow } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRY: Record<string, (orgId: string) => Promise<DocRow[]>> = {
  reorder: (o) => reorderAlerts(o),
  "dead-stock": (o) => deadStockAlerts(o),
  expiry: (o) => expiryAlerts(o),
};

/** GET /api/v1/alerts/:key — inventory alert list (reorder | dead-stock | expiry). */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const fn = REGISTRY[key];
  if (!fn) return Response.json({ error: "unknown_alert" }, { status: 404 });
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await fn(auth.orgId) });
}
