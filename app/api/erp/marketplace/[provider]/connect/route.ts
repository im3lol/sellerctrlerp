import { redirect } from "next/navigation";
import { requireErpModule } from "@/lib/erp/org";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { connectorEnabled } from "@/lib/saas/connector-enabled";
import { signState } from "@/lib/erp/marketplace/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a connector's OAuth consent flow for the current tenant. The `target` is
 * either a fixed marketplace code (Amazon: ?marketplace=EG) or a merchant-supplied
 * shop domain (Shopify: ?shop=store.myshopify.com) — connectors with needsTarget
 * require the ?shop= form. We sign a state carrying orgId + provider + target and
 * bounce to the connector's authorize URL.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const { orgId } = await requireErpModule("sales.create", "marketplace");

  const connector = getConnector(provider);
  if (!connector?.oauth) return new Response("موصّل غير مدعوم", { status: 404 });
  if (!(await connectorEnabled(connector.code))) return new Response("المنصّة غير مُفعّلة", { status: 404 });

  const url = new URL(req.url);
  const target = url.searchParams.get("shop") || url.searchParams.get("marketplace") || connector.oauth.marketplaces[0]?.code || "";
  // A no-target connector (Noon: one consent screen, no marketplace/shop) may proceed
  // with an empty target; only require one when the provider actually needs it.
  if (!target && (connector.oauth.needsTarget || connector.oauth.marketplaces.length > 0)) {
    return new Response("حدّد المتجر أو السوق أولًا", { status: 400 });
  }
  const state = signState({ orgId, provider: connector.code, marketplace: target, ts: Date.now() });
  const authUrl = await connector.oauth.authorizeUrl(state, target);
  if (!authUrl) return new Response("تعذّر بناء رابط التفويض — تحقق من إعداد التطبيق", { status: 500 });
  redirect(authUrl);
}
