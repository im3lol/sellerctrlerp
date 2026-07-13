import "server-only";
import { SPAPI_ENDPOINT, type Region } from "./constants";
import { refreshAccessToken } from "./lwa";
import type { Credential } from "../connector";

// SP-API HTTP client: mints a short-lived LWA access token from the stored
// refresh token (cached in-memory per token until ~1 min before expiry), then
// calls SP-API with it in the x-amz-access-token header. Modern SP-API needs no
// AWS SigV4 — the LWA token is the only credential. Retries on throttling.

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const r = await refreshAccessToken(refreshToken);
  if ("error" in r) throw new Error(r.error);
  cache.set(refreshToken, { token: r.access_token, expiresAt: Date.now() + (r.expires_in - 60) * 1000 });
  return r.access_token;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Call an SP-API path for a connection. Adds the access token + region host and
 * retries 429/503 with backoff (respects Retry-After). Returns the raw Response.
 */
export async function spFetch(cred: Credential, path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await getAccessToken(cred.refreshToken);
  const base = SPAPI_ENDPOINT[cred.region as Region] ?? SPAPI_ENDPOINT.eu;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-amz-access-token": token, "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if ((res.status === 429 || res.status === 503) && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
    return spFetch(cred, path, init, attempt + 1);
  }
  return res;
}

/** spFetch + JSON parse, throwing a readable error on non-2xx. */
export async function spJson<T = unknown>(cred: Credential, path: string, init?: RequestInit): Promise<T> {
  const res = await spFetch(cred, path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as { errors?: { message?: string }[] })?.errors?.[0]?.message || `SP-API ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}
