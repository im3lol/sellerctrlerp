import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { arAging, apAging, type AgingReport } from "@/lib/erp/mobile-reports";
import type { ErpPermission } from "@/lib/erp/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRY: Record<string, { perm: ErpPermission; fn: (orgId: string, asOf?: string) => Promise<AgingReport> }> = {
  ar: { perm: "sales.view", fn: arAging },
  ap: { perm: "purchases.view", fn: apAging },
};

/** GET /api/v1/aging/:kind?asOf — receivables (ar) / payables (ap) aging buckets. */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const entry = REGISTRY[kind];
  if (!entry) return Response.json({ error: "unknown_aging" }, { status: 404 });
  const auth = await authorizeApi(req, entry.perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const asOf = new URL(req.url).searchParams.get("asOf") || undefined;
  return Response.json({ data: await entry.fn(auth.orgId, asOf) });
}
