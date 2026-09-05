import "server-only";
import { assertPublicUrl } from "../safe-url";
import type { Credential } from "../connector";
import { signedQuery, commonParams } from "./constants";

// Jumia SellerCenter client. Per-seller: the API base host is cred.marketplaceId, the seller
// UserID (email) is cred.sellerId and the API key is cred.refreshToken (used only to sign,
// never sent). Retries throttling/5xx with backoff. SellerCenter has undocumented quota
// ceilings, so the request rate is kept modest by the sync scheduler.

export class JumiaError extends Error {
  constructor(message: string, public status: number, public code?: string, public isAuth = false) {
    super(message);
    this.name = "JumiaError";
  }
}

/** True when the failure means the seller's API key/UserID is invalid. */
export function isJumiaAuthError(e: unknown): boolean {
  return e instanceof JumiaError && e.isAuth;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API_TIMEOUT_MS = 30_000;

// SellerCenter error codes that mean bad credentials (vs a transient/other failure).
const AUTH_CODES = new Set(["AuthenticationError", "InvalidSignature", "InvalidUserID", "AccessDenied"]);

type ScResponse<T> = {
  SuccessResponse?: { Body?: T };
  ErrorResponse?: { Head?: { ErrorType?: string; ErrorCode?: string; ErrorMessage?: string } };
};

/**
 * Call one SellerCenter Action and return its Body. `extra` carries action-specific params
 * (filters, paging). Signs with the seller's API key. `now` is injected for testability.
 */
export async function jumiaCall<T>(cred: Credential, action: string, extra: Record<string, string> = {}, now = new Date(), attempt = 0): Promise<T> {
  const base = (cred.marketplaceId || "").replace(/\/$/, "");
  if (!base) throw new JumiaError("عنوان واجهة جوميا غير مضبوط", 400, "no_base");
  // The base host is tenant-supplied — refuse https-less and internal targets (SSRF).
  try { await assertPublicUrl(base); }
  catch (e) { throw new JumiaError(e instanceof Error ? e.message : "عنوان غير صالح", 400, "invalid_base"); }
  const params = { ...commonParams(action, cred.sellerId || "", now), ...extra };
  const qs = signedQuery(params, cred.refreshToken || "");

  const res = await fetch(`${base}?${qs}`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(API_TIMEOUT_MS) });

  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(Math.min(2 ** attempt, 20) * 1000 + 500);
    return jumiaCall<T>(cred, action, extra, now, attempt + 1);
  }
  const json = (await res.json().catch(() => ({}))) as ScResponse<T>;
  if (json.ErrorResponse) {
    const h = json.ErrorResponse.Head ?? {};
    const auth = AUTH_CODES.has(h.ErrorCode || "") || res.status === 401 || res.status === 403;
    throw new JumiaError(h.ErrorMessage || `Jumia ${h.ErrorCode || res.status}`, res.status || 400, h.ErrorCode, auth);
  }
  if (!res.ok || !json.SuccessResponse?.Body) throw new JumiaError(`Jumia ${res.status}`, res.status);
  return json.SuccessResponse.Body;
}

/** SellerCenter wraps single-vs-many as an object or array under a named key — normalize to array. */
export function scArray<T>(node: T | T[] | undefined | null): T[] {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}
