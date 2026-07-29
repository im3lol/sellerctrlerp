import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { ensurePlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import type { MarketplaceConnector } from "@/lib/erp/marketplace/connector";
import { verifyState, type OAuthState } from "@/lib/erp/marketplace/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CallbackExtract = { code: string; sellerId: string | null; marketplaceId: string | null; region: string } | { error: string };

/** Extract the auth code + seller identity from the callback query. Delegates to the
 *  connector's verifyCallback (Shopify: HMAC-verified) or falls back to Amazon's
 *  spapi_oauth_code + selling_partner_id + the state's marketplace. */
async function extractCallback(connector: MarketplaceConnector, url: URL, state: OAuthState): Promise<CallbackExtract> {
  if (connector.oauth?.verifyCallback) return connector.oauth.verifyCallback(url.searchParams, state);
  const code = url.searchParams.get("spapi_oauth_code") || url.searchParams.get("code");
  const sellerId = url.searchParams.get("selling_partner_id");
  if (!code) return { error: "لم يصل رمز التفويض" };
  const mp = connector.oauth?.marketplaces.find((m) => m.code === state.marketplace);
  if (!mp) return { error: "سوق غير مدعوم" };
  return { code, sellerId: sellerId || null, marketplaceId: mp.marketplaceId, region: mp.region };
}

/** OAuth redirect target: exchange the code for a refresh token and store it. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  // Client-side redirect (meta-refresh + JS), NOT a server 307. The callback is
  // reached via a cross-site navigation from the OAuth provider; a server redirect
  // to the protected platform page rides that cross-site context and some browsers
  // withhold the SameSite=Lax session cookie on it → the middleware bounces to /login
  // even though the tenant is logged in. A client-side navigation from this returned
  // HTML is unambiguously same-site, so the session cookie is always sent.
  const back = (ok: boolean, msg?: string): Response => {
    const to = `/platforms/${provider.toLowerCase()}?connected=${ok ? "1" : "0"}${msg ? `&err=${encodeURIComponent(msg)}` : ""}`;
    const j = JSON.stringify(to);
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to.replace(/"/g, "&quot;")}"><title>جارٍ التحويل…</title></head><body style="font-family:system-ui;padding:2rem;text-align:center">جارٍ إتمام الربط…<script>location.replace(${j})</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  };

  const connector = getConnector(provider);
  if (!connector?.oauth) return back(false, "موصّل غير مدعوم");

  const url = new URL(req.url);
  const state = verifyState(url.searchParams.get("state") || "");
  if (!state || state.provider !== connector.code) return back(false, "حالة تفويض غير صالحة أو منتهية");

  const v = await extractCallback(connector, url, state);
  if ("error" in v) return back(false, v.error);

  const appUrl = process.env.APP_URL || url.origin;
  const ex = await connector.oauth.exchangeCode(v.code, `${appUrl}/api/erp/marketplace/${provider.toLowerCase()}/callback`, state.marketplace);
  if ("error" in ex) return back(false, ex.error);

  // Resolve/provision the platform + store the token, RLS-scoped to the signed
  // state.orgId. The token exchange above ran unscoped (network I/O); the redirect
  // MUST stay outside this block so its thrown NEXT_REDIRECT can't roll back the insert.
  await withOrgScope(state.orgId, false, async () => {
    const [existing] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, state.orgId), eq(salesPlatforms.code, connector.code))).limit(1);
    let platformId: string | null = existing?.id ?? null;
    if (!platformId) platformId = (await ensurePlatform(state.orgId, connector.code))?.platformId ?? null;

    await db.insert(platformCredentials).values({
      organizationId: state.orgId, platformId, provider: connector.code.toLowerCase(),
      refreshToken: encryptSecret(ex.refreshToken),
      sellerId: v.sellerId, marketplaceId: v.marketplaceId, region: v.region, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [platformCredentials.organizationId, platformCredentials.provider],
      set: {
        refreshToken: encryptSecret(ex.refreshToken), sellerId: v.sellerId,
        marketplaceId: v.marketplaceId, region: v.region, platformId, updatedAt: new Date(),
        // Fresh token — clear any revoked-token flag so the scheduler resumes.
        needsReauth: false, lastSyncStatus: null,
      },
    });
  });

  // Best-effort: subscribe this seller to real-time ORDER_CHANGE notifications
  // (no-op unless the shared SQS queue env is configured; never blocks connect).
  try {
    const { sqsConfigured, ensureOrderNotifications } = await import("@/lib/erp/marketplace/amazon/notifications");
    if (connector.code === "AMAZON" && sqsConfigured()) {
      const r = await ensureOrderNotifications({ refreshToken: ex.refreshToken, sellerId: v.sellerId, marketplaceId: v.marketplaceId, region: v.region });
      if (!("error" in r)) {
        await withOrgScope(state.orgId, false, () =>
          db.update(platformCredentials)
            .set({ notifDestinationId: r.destinationId, notifSubscriptionId: r.subscriptionId, updatedAt: new Date() })
            .where(and(eq(platformCredentials.organizationId, state.orgId), eq(platformCredentials.provider, connector.code.toLowerCase()))));
      }
    }
  } catch { /* notifications are optional */ }
  return back(true);
}
