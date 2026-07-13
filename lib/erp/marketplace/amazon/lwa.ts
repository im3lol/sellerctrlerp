import "server-only";
import { LWA_TOKEN_URL } from "./constants";

// Login-with-Amazon (LWA) token exchange. The app-level client id/secret serve
// every tenant ("Public Solution Provider"); each tenant stores only its own
// refresh token (encrypted).
function lwaCreds(): { id: string; secret: string } | null {
  const id = process.env.SPAPI_LWA_CLIENT_ID;
  const s = process.env.SPAPI_LWA_CLIENT_SECRET;
  return id && s ? { id, secret: s } : null;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

async function lwaToken(params: Record<string, string>): Promise<TokenResponse | { error: string }> {
  const creds = lwaCreds();
  if (!creds) return { error: "لم تُضبط بيانات تطبيق أمازون (SPAPI_LWA_CLIENT_ID/SECRET)" };
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: creds.id, client_secret: creds.secret }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json?.error_description || json?.error || `فشل تبادل التوكن (${res.status})` };
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
