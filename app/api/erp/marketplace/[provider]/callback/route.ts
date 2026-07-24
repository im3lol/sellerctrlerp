import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { verifyState } from "@/lib/erp/marketplace/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth redirect target: exchange the code for a refresh token and store it. */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const back = (ok: boolean, msg?: string) =>
    redirect(`/platforms/${provider.toLowerCase()}?connected=${ok ? "1" : "0"}${msg ? `&err=${encodeURIComponent(msg)}` : ""}`);

  const connector = getConnector(provider);
  if (!connector?.oauth) return back(false, "موصّل غير مدعوم");

  const url = new URL(req.url);
  const code = url.searchParams.get("spapi_oauth_code") || url.searchParams.get("code");
  const sellerId = url.searchParams.get("selling_partner_id");
  const state = verifyState(url.searchParams.get("state") || "");
  if (!state || state.provider !== connector.code) return back(false, "حالة تفويض غير صالحة أو منتهية");
  if (!code) return back(false, "لم يصل رمز التفويض");

  const mp = connector.oauth.marketplaces.find((m) => m.code === state.marketplace);
  if (!mp) return back(false, "سوق غير مدعوم");

  const appUrl = process.env.APP_URL || url.origin;
  const ex = await connector.oauth.exchangeCode(code, `${appUrl}/api/erp/marketplace/${provider.toLowerCase()}/callback`);
  if ("error" in ex) return back(false, ex.error);

  // Resolve/provision the platform + store the token, RLS-scoped to the signed
  // state.orgId. The token exchange above ran unscoped (network I/O); the redirect
  // MUST stay outside this block so its thrown NEXT_REDIRECT can't roll back the insert.
  await withOrgScope(state.orgId, false, async () => {
    const [existing] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, state.orgId), eq(salesPlatforms.code, connector.code))).limit(1);
    let platformId = existing?.id ?? null;
    if (!platformId && connector.code === "AMAZON") platformId = (await ensureAmazonPlatform(state.orgId)).platformId;

    await db.insert(platformCredentials).values({
      organizationId: state.orgId, platformId, provider: connector.code.toLowerCase(),
      refreshToken: encryptSecret(ex.refreshToken),
      sellerId: sellerId || null, marketplaceId: mp.marketplaceId, region: mp.region, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [platformCredentials.organizationId, platformCredentials.provider],
      set: {
        refreshToken: encryptSecret(ex.refreshToken), sellerId: sellerId || null,
        marketplaceId: mp.marketplaceId, region: mp.region, platformId, updatedAt: new Date(),
        // Fresh token — clear any revoked-token flag so the scheduler resumes.
        needsReauth: false, lastSyncStatus: null,
      },
    });
  });
  return back(true);
}
