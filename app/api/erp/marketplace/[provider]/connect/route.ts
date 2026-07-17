import { redirect } from "next/navigation";
import { requireErpModule } from "@/lib/erp/org";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { signState } from "@/lib/erp/marketplace/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a connector's OAuth consent flow for the current tenant. The seller picks
 * a marketplace (?marketplace=EG); we sign a state carrying orgId + provider +
 * marketplace and bounce to the connector's authorize URL.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { orgId } = await requireErpModule("sales.create", "marketplace");

  const connector = getConnector(provider);
  if (!connector?.oauth) return new Response("موصّل غير مدعوم", { status: 404 });

  const marketplace = new URL(req.url).searchParams.get("marketplace") || connector.oauth.marketplaces[0]?.code || "";
  const state = signState({ orgId, provider: connector.code, marketplace, ts: Date.now() });
  const url = connector.oauth.authorizeUrl(state, marketplace);
  if (!url) return new Response("تعذّر بناء رابط التفويض — تحقق من إعداد التطبيق", { status: 500 });
  redirect(url);
}
