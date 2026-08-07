// Pure Jumia SellerCenter helpers (no server deps) — safe to import from tests.
// Jumia's Vendor/SellerCenter API is an "Action" API: every call is a GET with common
// params (Action/UserID/Version/Timestamp/Format) plus a Signature. The API key signs the
// request (HMAC-SHA256) and never travels itself.
import { createHmac } from "node:crypto";

export const JUMIA_API_VERSION = "1.0";
export const JUMIA_REGION = "jumia";

// RFC-3986 percent-encoding (SellerCenter signs the RFC-3986 form, not the looser
// encodeURIComponent default which leaves !'()* unescaped).
function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Build the signed query string for a SellerCenter request (pure — the security core).
 * Algorithm: take all params EXCEPT Signature, sort by key, join as `k=v&…` with RFC-3986
 * encoding, HMAC-SHA256 with the API key (hex), then append `&Signature=…`.
 */
export function signedQuery(params: Record<string, string>, apiKey: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== "Signature")
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`)
    .join("&");
  const signature = createHmac("sha256", apiKey).update(base).digest("hex");
  return `${base}&Signature=${signature}`;
}

/** The common params every call carries. `now` is injected so it's testable. */
export function commonParams(action: string, userId: string, now: Date): Record<string, string> {
  return {
    Action: action,
    Format: "JSON",
    Timestamp: now.toISOString(),
    UserID: userId,
    Version: JUMIA_API_VERSION,
  };
}
