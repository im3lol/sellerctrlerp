import { postAmazonSettlementsAction } from "@/app/actions/erp/amazon-settlement";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/platforms/:code/settlements/post
 * Posts only already-imported, released and currently-unposted rows. The settlement
 * core remains atomic and rechecks for concurrent posting under a DB lock. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await authorizeApi(req, "accounting.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) {
    return Response.json({ error: "module_unavailable" }, { status: 403 });
  }
  const { code } = await params;
  return runAsErp(auth, async () => {
    const platform = await getAmazonPlatform(auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    const result = await postAmazonSettlementsAction(platform.code);
    if (!result.ok) return Response.json({ error: result.error ?? "تعذّر ترحيل التسويات" }, { status: 400 });
    return Response.json({ ok: true, posted: result.posted, deferredHeld: result.deferredHeld, returnsCreated: result.returnsCreated });
  });
}
