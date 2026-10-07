import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform, getMobileFbaReconciliation } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) return Response.json({ error: "module_unavailable" }, { status: 403 });
  const { code } = await params;
  return runAsErp(auth, async () => {
    if (!(await getAmazonPlatform(auth.orgId, code))) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    return Response.json({ data: await getMobileFbaReconciliation(auth.orgId) });
  });
}
