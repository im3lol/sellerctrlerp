import "server-only";
import type { OAuthExchange } from "../connector";
import type { OAuthState } from "../oauth-state";
import {
  NOON_GATEWAY, NOON_OAUTH_AUTHORIZE, NOON_OAUTH_TOKEN_CREATE, NOON_OAUTH_TOKEN_EXCHANGE,
  NOON_USER_AGENT, type NoonCreds,
} from "./constants";
import { getNoonConfig } from "@/lib/saas/noon-config";

/**
 * Noon integrator OAuth — the one-click "connect like Amazon" flow. Two steps after
 * the seller consents:
 *   1. token/create: authorization code → short-lived access_token (+ project_code)
 *   2. token/exchange: access_token → the seller's service-account credentials
 *      (private_key + key_id + channel_identifier + project_code)
 * We store those creds as the connector's refreshToken (same shape parseNoonCreds
 * reads), so every downstream call works identically to a pasted .json.
 * The redirect_uri is pre-registered with Noon (not sent in the URL).
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

const JSONH = { "content-type": "application/json", accept: "application/json", "user-agent": NOON_USER_AGENT };
const OAUTH_TIMEOUT_MS = 15_000;
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return "";
};

/** Read a Noon token response as JSON. The gateway serves its HTML app for unmatched
 *  routes, so an HTML body means the OAuth path is wrong (not a real API error) — surface
 *  that clearly instead of throwing a cryptic JSON-parse error (or hanging into a 524). */
async function readTokenJson(res: Response, step: string): Promise<Record<string, unknown> | { __err: string }> {
  const text = await res.text().catch(() => "");
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html") || text.trimStart().startsWith("<")) {
    return { __err: `مسار OAuth الخاص بنون غير صحيح (${step}) — عيّن NOON_OAUTH_CREATE_PATH / NOON_OAUTH_EXCHANGE_PATH بالمسار الصحيح من بوابة مطوّري نون` };
  }
  if (!res.ok) return { __err: `فشل ${step} من نون: ${text.slice(0, 160)}` };
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { __err: `رد غير صالح من نون (${step})` }; }
}

/** code → seller service-account credentials, stored as the refreshToken JSON. */
export async function exchangeCode(code: string): Promise<OAuthExchange> {
  const cfg = await getNoonConfig();
  if (!cfg) return { error: "ربط نون بالـOAuth غير مُهيّأ — اضبط المفاتيح من لوحة الأدمن (التكاملات)" };
  try {
    // 1) authorization code → access_token (+ project_code)
    const cr = await fetch(NOON_GATEWAY + NOON_OAUTH_TOKEN_CREATE, {
      method: "POST", headers: JSONH, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
      body: JSON.stringify({ grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    });
    const created = await readTokenJson(cr, "token/create") as { access_token?: string; project_code?: string; __err?: string };
    if (created.__err) return { error: created.__err };
    if (!created.access_token) return { error: "لم تُرجع نون رمز وصول" };

    // 2) access_token → the seller's service-account credentials
    const ex = await fetch(NOON_GATEWAY + NOON_OAUTH_TOKEN_EXCHANGE, {
      method: "POST", headers: { ...JSONH, authorization: `Bearer ${created.access_token}` }, body: "{}",
      signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),
    });
    const exBody = await readTokenJson(ex, "token/exchange");
    if ("__err" in exBody) return { error: exBody.__err as string };
    const body = exBody;
    // The creds may sit at the root or under `result`/`data`.
    const r = (body.result ?? body.data ?? body) as Record<string, unknown>;

    const creds: NoonCreds = {
      key_id: pick(r, "key_id", "keyId", "kid"),
      private_key: pick(r, "private_key", "privateKey"),
      channel_identifier: pick(r, "channel_identifier", "channelIdentifier", "username"),
      project_code: pick(r, "project_code", "projectCode") || created.project_code || "",
      type: "apijwt",
    };
    if (!creds.key_id || !creds.private_key || !creds.channel_identifier || !creds.project_code) {
      return { error: "اعتماد نون المُستلم ناقص — راجع إعداد تطبيق OAuth" };
    }
    // sellerId = project_code so the order webhook can resolve the tenant.
    return { refreshToken: JSON.stringify(creds), sellerId: creds.project_code, marketplaceId: null, region: "eg" };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "خطأ غير متوقع في ربط نون" };
  }
}
