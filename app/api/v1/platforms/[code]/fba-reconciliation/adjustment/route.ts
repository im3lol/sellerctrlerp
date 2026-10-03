import { createAdjustmentFromAuditAction } from "@/app/actions/erp/fba-inventory";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform } from "@/lib/erp/mobile-marketplace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates one stock-adjustment DRAFT from only LOST/FOUND audit lines. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) return Response.json({ error: "module_unavailable" }, { status: 403 });
  const { code } = await params;
  return runAsErp(auth, async () => {
    if (!(await getAmazonPlatform(auth.orgId, code))) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    const result = await createAdjustmentFromAuditAction();
    if (!result.ok) return Response.json({ error: result.error ?? "تعذّر إنشاء مسودة التسوية" }, { status: 400 });
    return Response.json({ ok: true, id: result.id, number: result.number, count: result.count });
  });
}
