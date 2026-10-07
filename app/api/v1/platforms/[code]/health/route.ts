import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform, getMobileAmazonHealth } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/platforms/:code/health — read-only Amazon operational checks. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await authorizeApi(req, "sales.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) {
    return Response.json({ error: "module_unavailable" }, { status: 403 });
  }
  const { code } = await params;
  return runAsErp(auth, async () => {
    const platform = await getAmazonPlatform(auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    return Response.json({ data: { platform, ...(await getMobileAmazonHealth(auth.orgId, platform, auth.can("inventory.view"))) } });
  });
}
