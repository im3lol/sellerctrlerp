import "server-only";
import { LWA_TOKEN_URL } from "./constants";
import { getAmazonConfig } from "@/lib/saas/amazon-config";

// Login-with-Amazon (LWA) token exchange. The app-level client id/secret serve
// every tenant ("Public Solution Provider"); each tenant stores only its own
// refresh token (encrypted). Creds come from the DB singleton (owner sets them in
// /admin/integrations), env as fallback — see getAmazonConfig.

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

async function lwaToken(params: Record<string, string>): Promise<TokenResponse | { error: string; code?: string }> {
  const cfg = await getAmazonConfig();
  if (!cfg) return { error: "لم تُضبط بيانات تطبيق أمازون — اضبط المفاتيح من لوحة الأدمن (التكاملات)" };
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: cfg.lwaClientId, client_secret: cfg.lwaClientSecret }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // `code` = the raw LWA error (invalid_grant, invalid_client, ...) so the
    // client can classify revoked tokens.
    return { error: json?.error_description || json?.error || `فشل تبادل التوكن (${res.status})`, code: json?.error };
  }
  return json as TokenResponse;
}

/** Exchange the one-time authorization code for a long-lived refresh token. */
export function exchangeCode(code: string, redirectUri: string) {
  return lwaToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

/** Mint a short-lived access token from a stored refresh token. */
export function refreshAccessToken(refreshToken: string) {
  return lwaToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Grantless token (client_credentials) — required by Notifications createDestination. */
export function grantlessToken(scope = "sellingpartnerapi::notifications") {
  return lwaToken({ grant_type: "client_credentials", scope });
}
