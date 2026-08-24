import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// HMAC-signed OAuth `state` — carries the tenant + provider + chosen marketplace
// through a connector's consent round-trip and defends against CSRF. Generic
// across providers; signed with AUTH_SECRET.
const secret = process.env.AUTH_SECRET ?? "dev-insecure-key-change-me";
const b64url = (b: Buffer) => b.toString("base64url");

export type OAuthState = { orgId: string; provider: string; marketplace: string; ts: number };

export function signState(payload: OAuthState): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyState(token: string): OAuthState | null {
  const [body, mac] = (token || "").split(".");
  if (!body || !mac) return null;
  const expected = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as OAuthState;
    // marketplace is OPTIONAL — no-target connectors (Noon: one consent screen, no
    // marketplace/shop) legitimately carry an empty marketplace. Only orgId + provider
    // are required. Requiring marketplace here made Noon OAuth always fail at callback.
    if (!p.orgId || !p.provider) return null;
    if (Date.now() - p.ts > 15 * 60 * 1000) return null; // consent must complete within 15 min
    return p;
  } catch {
    return null;
  }
}
