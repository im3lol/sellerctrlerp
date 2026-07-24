import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { SPAPI_ENDPOINT, type Region } from "./constants";
import { refreshAccessToken } from "./lwa";
import type { Credential } from "../connector";

// SP-API HTTP client: mints a short-lived LWA access token from the stored
// refresh token (cached in-memory per token until ~1 min before expiry), then
// calls SP-API with it in the x-amz-access-token header. Modern SP-API needs no
// AWS SigV4 — the LWA token is the only credential. Retries on throttling.

/** Typed SP-API failure so callers can branch on throttle/auth/server classes. */
export class SpApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retriable = false,
    public isAuth = false,
  ) {
    super(message);
    this.name = "SpApiError";
  }
}

/** True when the failure means the tenant's refresh token is revoked/expired. */
export function isAuthError(e: unknown): boolean {
  return e instanceof SpApiError && e.isAuth;
}

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();
// Singleflight: concurrent misses for the same refresh token share one LWA call.
const pending = new Map<string, Promise<string>>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const hit = cache.get(refreshToken);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const inFlight = pending.get(refreshToken);
  if (inFlight) return inFlight;
  // ponytail: prune expired entries on each miss — bounded by tenant count, no LRU needed.
  for (const [k, v] of cache) if (v.expiresAt <= Date.now()) cache.delete(k);
  const p = (async () => {
    const r = await refreshAccessToken(refreshToken);
    if ("error" in r) {
      // invalid_grant = the seller revoked/expired our authorization — an auth
      // failure the scheduler must stop retrying. invalid_client is OUR env
      // misconfig, not the tenant's token.
      throw new SpApiError(r.error, 400, r.code, false, r.code === "invalid_grant");
    }
    cache.set(refreshToken, { token: r.access_token, expiresAt: Date.now() + (r.expires_in - 60) * 1000 });
    return r.access_token;
  })().finally(() => pending.delete(refreshToken));
  pending.set(refreshToken, p);
  return p;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Per-run SP-API request counter (fills sync_runs.api_requests). AsyncLocalStorage
// so nothing threads a counter through the connector call chains.
const requestCounter = new AsyncLocalStorage<{ n: number }>();

/** Run fn counting every SP-API request made inside it; returns [result, count]. */
export async function withRequestCount<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const c = { n: 0 };
  const r = await requestCounter.run(c, fn);
  return [r, c.n];
}

function countRequest(): void {
  const c = requestCounter.getStore();
  if (c) c.n++;
}

// Proactive rate limiting: SP-API operations have tight per-second quotas
// (getOrderItems 0.5/s, getOrders ~1/s burst). Firing calls back-to-back blows
// the quota and triggers "You exceeded your quota" 429s that outlast our backoff.
// `paced` serializes calls sharing a key and spaces their starts by minIntervalMs,
// so we stay under the limit instead of only reacting to 429s. Per-process (one
// worker), which matches SP-API's per-account limits.
// ponytail: in-process gates assume ONE worker replica; scaling workers
// horizontally needs a Redis-based pacer before adding replicas.
const gateChain = new Map<string, Promise<unknown>>();
const gateLast = new Map<string, number>();

/**
 * Per-connection discriminator for pacing keys. SP-API quotas are per selling-
 * partner ACCOUNT × operation, so in a multi-tenant worker each tenant must pace
 * on its own gate — a single global gate would needlessly serialize independent
 * accounts. sellerId identifies the account; fall back to marketplace/token.
 */
export function credKey(cred: Credential): string {
  return cred.sellerId || cred.marketplaceId || cred.refreshToken.slice(0, 16);
}

export function paced<T>(key: string, minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const gap = Date.now() - (gateLast.get(key) ?? 0);
    if (gap < minIntervalMs) await sleep(minIntervalMs - gap);
    gateLast.set(key, Date.now());
    return fn();
  };
  const next = (gateChain.get(key) ?? Promise.resolve()).then(run, run); // serialize past failures too
  gateChain.set(key, next.catch(() => {}));
  return next;
}

const API_TIMEOUT_MS = 30_000;

/**
 * Call an SP-API path for a connection. Adds the access token + region host,
 * a request timeout, and retries: 429/503 up to 8 attempts (respects Retry-After
 * as a floor), transient 5xx up to 3. Backoff is jittered so many tenants don't
 * retry in lockstep. Returns the raw Response.
 */
export async function spFetch(cred: Credential, path: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  const token = await getAccessToken(cred.refreshToken);
  const base = SPAPI_ENDPOINT[cred.region as Region] ?? SPAPI_ENDPOINT.eu;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-amz-access-token": token, "content-type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
  });
  countRequest();
  const throttled = res.status === 429 || res.status === 503;
  const serverErr = res.status === 500 || res.status === 502 || res.status === 504;
  if ((throttled && attempt < 8) || (serverErr && attempt < 3)) {
    // Amazon often omits Retry-After on quota 429s; the throttle can be ~1/min, so
    // grow the wait up to 60s instead of giving up after a few short retries.
    // Retry-After is a floor (never wait less than Amazon asked); otherwise full
    // jitter on the exponential backoff.
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000 + Math.random() * 1000
      : Math.random() * Math.min(2 ** attempt, 60) * 1000 + 500;
    await sleep(waitMs);
    return spFetch(cred, path, init, attempt + 1);
  }
  return res;
}

/** spFetch + JSON parse, throwing a typed SpApiError on non-2xx. */
export async function spJson<T = unknown>(cred: Credential, path: string, init?: RequestInit): Promise<T> {
  const res = await spFetch(cred, path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { errors?: { message?: string; code?: string }[] })?.errors?.[0];
    // isAuth stays false here: a 401/403 from SP-API can be a missing role or
    // marketplace permission, not a revoked token — only LWA invalid_grant
    // (thrown in getAccessToken) proves the tenant must re-connect.
    throw new SpApiError(err?.message || `SP-API ${res.status}`, res.status, err?.code, res.status === 429 || res.status >= 500);
  }
  return json as T;
}
