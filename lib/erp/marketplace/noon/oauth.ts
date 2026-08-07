import "server-only";
import type { OAuthExchange } from "../connector";
import type { OAuthState } from "../oauth-state";
import {
  NOON_OAUTH_AUTHORIZE, NOON_OAUTH_TOKEN_CREATE, NOON_OAUTH_TOKEN_EXCHANGE, type NoonCreds,
} from "./constants";
import { noonFetch } from "./client";
import { getNoonConfig, getNoonIntegratorCreds } from "@/lib/saas/noon-config";

/**
 * Noon integrator OAuth — the one-click "connect like Amazon" flow. The token endpoints
 * require an AUTHENTICATED session (like every non-/public Noon call), so we drive them
 * through noonFetch using SellerCtrl's OWN service account (NOON_INTEGRATOR_CREDS). After
 * the seller consents:
 *   1. token/create: authorization code → short-lived access_token (+ project_code)
 *   2. token/exchange: access_token → the workflow `result` = the seller's issued
 *      service-account credentials (private_key + key_id + channel_identifier + project_code)
 * We store those creds as the connector's refreshToken (same shape parseNoonCreds reads),
 * so every downstream call works identically to a pasted .json. redirect_uri is
 * pre-registered with Noon (not sent in the URL).
 */

/** Consent URL. Null when OAuth isn't configured (falls back to the paste-.json card). */
export async function authorizeUrl(state: string): Promise<string | null> {
  const cfg = await getNoonConfig();
  if (!cfg) return null;
  const u = new URL(NOON_OAUTH_AUTHORIZE);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("state", state);
  return u.toString();
}

/** The signed state already proved the request; just pull the code out. Seller identity
 *  (project_code) isn't known until the exchange, so it's returned from exchangeCode. */
export async function verifyCallback(params: URLSearchParams, _state: OAuthState): Promise<
  { code: string; sellerId: string | null; marketplaceId: string | null; region: string } | { error: string }
> {
  const code = params.get("code");
  if (!code) return { error: "لم يصل رمز التفويض من نون" };
  return { code, sellerId: null, marketplaceId: null, region: "eg" };
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return "";
};

/** code → seller service-account credentials, stored as the refreshToken JSON. */
export async function exchangeCode(code: string): Promise<OAuthExchange> {
  const cfg = await getNoonConfig();
  if (!cfg) return { error: "ربط نون بالـOAuth غير مُهيّأ — اضبط المفاتيح من لوحة الأدمن (التكاملات)" };
  // The token endpoints require an authenticated session; SellerCtrl's own service account
  // (NOON_INTEGRATOR_CREDS) provides it. Without it, Noon serves its HTML app → the ربط يفشل.
  const integrator = await getNoonIntegratorCreds();
  if (!integrator) return { error: "لم تُضبط بيانات حساب خدمة نون الخاص بالمنصّة (NOON_INTEGRATOR_CREDS) — لازمة لإتمام الربط بنقرة واحدة" };
  try {
    // 1) authorization code → access_token (authenticated via the integrator session)
    const created = await noonFetch<{ access_token?: string; project_code?: string }>(integrator, NOON_OAUTH_TOKEN_CREATE, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    });
    if (!created.access_token) return { error: "لم تُرجع نون رمز وصول" };

    // 2) access_token → workflow result = the seller's issued service-account credentials
    const exchanged = await noonFetch<{ result?: Record<string, unknown>; project_code?: string }>(integrator, NOON_OAUTH_TOKEN_EXCHANGE, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: created.access_token }),
    });
    // result holds the protected resource; the credential may be at its root or under `credential`.
    const res = (exchanged.result ?? {}) as Record<string, unknown>;
    const r = ((res.credential as Record<string, unknown>) ?? res) as Record<string, unknown>;

    const creds: NoonCreds = {
      key_id: pick(r, "key_id", "keyId", "kid"),
      private_key: pick(r, "private_key", "privateKey"),
      channel_identifier: pick(r, "channel_identifier", "channelIdentifier", "username"),
      project_code: pick(r, "project_code", "projectCode") || exchanged.project_code || created.project_code || "",
      type: "apijwt",
    };
    if (!creds.key_id || !creds.private_key || !creds.channel_identifier || !creds.project_code) {
      return { error: "اعتماد نون المُستلم ناقص — راجع إعداد workflow الخاص بتطبيق OAuth عند نون" };
    }
    // sellerId = project_code so the order webhook can resolve the tenant.
    return { refreshToken: JSON.stringify(creds), sellerId: creds.project_code, marketplaceId: null, region: "eg" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطأ غير متوقع في ربط نون" };
  }
}
