import "server-only";
import crypto from "node:crypto";
import { paced } from "../amazon/client";
import { NOON_GATEWAY, NOON_LOGIN_PATH, NOON_USER_AGENT, parseNoonCreds, type NoonCreds } from "./constants";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Noon rate-limits per Project Code (fixed window, ~1500/60s). Pace ~5 req/s per project —
// well under the limit — and honor 429 with jittered backoff. Reuses the shared pacer, so
// the distributed (Redis) gate covers multi-worker deployments too.
const NOON_PACE_MS = 200;

/**
 * Noon API client. Auth (verified live against the gateway):
 *   POST /identity/public/v1/api/login  body { token: <JWT>, default_project_code }
 *   JWT: RS256, header.kid = key_id; claims { sub: key_id, iss: channel_identifier,
 *   iat, exp, jti: <uuid> }  → sets session cookies (_npsid, _nprtnetid) reused on
 *   every subsequent call. Sessions last ~30 days; we cache the cookie in-process
 *   and re-login on 401. Every data call also needs a User-Agent header.
 */

export class NoonError extends Error {
  constructor(message: string, readonly status: number, readonly isAuth = false) { super(message); }
}
export function isNoonAuthError(e: unknown): boolean {
  return e instanceof NoonError && e.isAuth;
}

const b64url = (input: crypto.BinaryLike) => Buffer.from(input as Buffer).toString("base64url");

function signJwt(c: NoonCreds): string {
  const header = { alg: "RS256", typ: "JWT", kid: c.key_id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: c.key_id, iss: c.channel_identifier, iat: now, exp: now + 300, jti: crypto.randomUUID() };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(signingInput), c.private_key);
  return `${signingInput}.${b64url(sig)}`;
}

// In-process session cache keyed by key_id (single app instance, same pattern as the
// Amazon token cache). Value = the Cookie header to replay.
type Session = { cookie: string; at: number };
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 25 * 24 * 60 * 60 * 1000; // re-login well within the 30-day life

async function login(c: NoonCreds): Promise<string> {
  const res = await fetch(NOON_GATEWAY + NOON_LOGIN_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": NOON_USER_AGENT },
    body: JSON.stringify({ token: signJwt(c), default_project_code: c.project_code }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new NoonError(`فشل تسجيل الدخول لنون: ${body.slice(0, 200)}`, res.status, res.status === 400 || res.status === 401);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((sc) => sc.split(";")[0]).join("; ");
  if (!cookie) throw new NoonError("لم تُرجع نون كوكيز جلسة", res.status);
  sessions.set(c.key_id, { cookie, at: Date.now() });
  return cookie;
}

async function ensureSession(c: NoonCreds): Promise<string> {
  const s = sessions.get(c.key_id);
  if (s && Date.now() - s.at < SESSION_TTL_MS) return s.cookie;
  return login(c);
}

/**
 * Authenticated JSON call to the Noon gateway. `path` is service-namespaced, e.g.
 * "/catalog/public/v1/...". Re-logs-in once on a 401 (stale session) and retries.
 */
export async function noonFetch<T>(refreshToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const c = parseNoonCreds(refreshToken);
  const call = async (cookie: string) => fetch(NOON_GATEWAY + path, {
    ...init,
    headers: { accept: "application/json", "user-agent": NOON_USER_AGENT, ...(init.headers ?? {}), cookie },
  });

  return paced(`noon:${c.project_code || c.key_id}`, NOON_PACE_MS, async () => {
    let res = await call(await ensureSession(c));
    if (res.status === 401) { sessions.delete(c.key_id); res = await call(await login(c)); }
    // Fixed-window 429 → jittered exponential backoff (Noon documents no Retry-After).
    for (let attempt = 0; res.status === 429 && attempt < 5; attempt++) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 + Math.random() * 500 : Math.random() * Math.min(2 ** attempt, 30) * 1000 + 500);
      res = await call(await ensureSession(c));
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new NoonError(`طلب نون فشل (${path}): ${body.slice(0, 200)}`, res.status, res.status === 401);
    }
    return res.json() as Promise<T>;
  });
}
