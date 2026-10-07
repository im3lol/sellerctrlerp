import { confirmPlatformReturnAction, type ReturnDecision } from "@/app/actions/erp/platform-returns";
import { salesReturns } from "@/db/schema";
import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { db } from "@/lib/db";
import { orgHasModule } from "@/lib/erp/entitlements";
import { getAmazonPlatform } from "@/lib/erp/mobile-marketplace";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/platforms/:code/returns/:id/confirm — receipt-gated marketplace return.
 * The request must name what physically arrived; the domain action decides whether it
 * restocks, isolates, or writes off goods before it posts the credit note. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const auth = await authorizeApi(req, "sales.confirm");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "super_admin" && !(await orgHasModule(auth.orgId, "marketplace"))) {
    return Response.json({ error: "module_unavailable" }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as ReturnDecision | null;
  if (!body || (body.kind !== "RECEIVED" && body.kind !== "NOT_RECEIVED")) {
    return Response.json({ error: "bad_return_decision" }, { status: 400 });
  }
  const { code, id } = await params;
  return runAsErp(auth, async () => {
    const platform = await getAmazonPlatform(auth.orgId, code);
    if (!platform) return Response.json({ error: "amazon_platform_not_found" }, { status: 404 });
    // Prevent an in-org ID from being used to confirm another channel's return.
    const [ret] = await db.select({ id: salesReturns.id }).from(salesReturns)
      .where(and(eq(salesReturns.id, id), eq(salesReturns.organizationId, auth.orgId), eq(salesReturns.channel, platform.code))).limit(1);
    if (!ret) return Response.json({ error: "marketplace_return_not_found" }, { status: 404 });
    const result = await confirmPlatformReturnAction(id, body);
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}
