import "server-only";

// Noon API gateway. Services are path-namespaced under it: identity / catalog /
// stock / fbpi. Override per-deployment with NOON_BASE_URL.
export const NOON_GATEWAY = process.env.NOON_BASE_URL || "https://noon-api-gateway.noon.partners";
export const NOON_LOGIN_PATH = "/identity/public/v1/api/login";
// Noon rejects requests without a User-Agent identifying the integration.
export const NOON_USER_AGENT = "SellerCtrl/1.0 (+https://sellerctrl.com)";

// ── Integrator OAuth (one-click seller connect, like Amazon) ──
// The seller authorizes SellerCtrl on Noon's consent screen; we exchange the code for
// the seller's own service-account credentials (private key + project_code) and store
// them exactly like a pasted .json. Requires OAuth client creds from Noon (contact
// them to register SellerCtrl as an integrator + whitelist the redirect URI).
export const NOON_OAUTH_AUTHORIZE = process.env.NOON_OAUTH_BASE || "https://oauth.noon.partners/";
export const NOON_OAUTH_TOKEN_CREATE = "/identity/oauth/v1/token/create";
export const NOON_OAUTH_TOKEN_EXCHANGE = "/identity/oauth/v1/token/exchange";
// The OAuth client_id/secret live in platform_settings (owner sets them in
// /admin/integrations), env as fallback — see lib/saas/noon-config.ts getNoonConfig().

/** The service-account key file a seller downloads from access.noon.partners.
 *  We store the whole JSON (encrypted) in platform_credentials.refreshToken. */
export type NoonCreds = {
  key_id: string;
  private_key: string;        // PEM RSA private key
  channel_identifier: string; // e.g. seller@pNNNNNN.idp.noon.partners
  project_code: string;       // e.g. PRJNNNNNN
  type?: string;              // "apijwt"
};

/** Parse + validate the stored credential JSON. Throws a friendly error if malformed. */
export function parseNoonCreds(refreshToken: string): NoonCreds {
  let c: Partial<NoonCreds>;
  try { c = JSON.parse(refreshToken); } catch { throw new Error("بيانات اعتماد نون غير صالحة (JSON)"); }
  if (!c.key_id || !c.private_key || !c.channel_identifier || !c.project_code) {
    throw new Error("ملف اعتماد نون ناقص (key_id / private_key / channel_identifier / project_code)");
  }
  return c as NoonCreds;
}
