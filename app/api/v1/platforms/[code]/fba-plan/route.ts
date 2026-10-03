import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform, getMobileFbaPlan } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/platforms/:code/fba-plan — read-only FBA replenishment plan using web-equivalent math. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) {
    return Response.json({ error: "module_unavailable" }, { status: 403 });
  }
  const { code } = await params;
  return runAsErp(auth, async () => {
    const platform = await getAmazonPlatform(auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    return Response.json({ data: await getMobileFbaPlan(auth.orgId, platform, new URL(req.url).searchParams) });
  });
}
