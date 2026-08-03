import "server-only";

// Noon API gateway. Services are path-namespaced under it: identity / catalog /
// stock / fbpi. Override per-deployment with NOON_BASE_URL.
export const NOON_GATEWAY = process.env.NOON_BASE_URL || "https://noon-api-gateway.noon.partners";
export const NOON_LOGIN_PATH = "/identity/public/v1/api/login";

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
