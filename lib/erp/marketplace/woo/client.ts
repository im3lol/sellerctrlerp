import "server-only";
import type { Credential } from "../connector";
import { validateStoreUrl, wcApiUrl } from "./constants";
import { assertPublicUrl } from "../safe-url";

// WooCommerce REST client. Per-store: the store origin is cred.sellerId, the consumer key
// is cred.marketplaceId and the consumer secret is cred.refreshToken (HTTPS Basic auth — no
// token refresh, WC keys are permanent until revoked). Retries 429/5xx with backoff.

export class WooError extends Error {
  constructor(message: string, public status: number, public code?: string, public isAuth = false) {
    super(message);
    this.name = "WooError";
  }
}

/** True when the failure means the store's API keys are revoked/invalid. */
export function isWooAuthError(e: unknown): boolean {
  return e instanceof WooError && e.isAuth;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API_TIMEOUT_MS = 30_000;

function authHeader(cred: Credential): string {
  // Basic auth: consumer key = username, consumer secret = password.
  const key = cred.marketplaceId || "";
  const secret = cred.refreshToken || "";
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

/** GET one WC endpoint page. Returns the parsed JSON array plus the total-pages header. */
async function wcGet<T>(cred: Credential, path: string, params: Record<string, string | number>, attempt = 0): Promise<{ rows: T[]; totalPages: number }> {
  const origin = validateStoreUrl(cred.sellerId || "");
  if (!origin) throw new WooError("رابط متجر ووكومرس غير صالح", 400, "invalid_store");
  const url = new URL(wcApiUrl(origin, path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // Re-checked per call, not just at connect time: a public name repointed at an
  // internal address (DNS rebinding) must fail here.
  await assertPublicUrl(url);

  const res = await fetch(url, {
    headers: { authorization: authHeader(cred), accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new WooError("انتهت صلاحية مفاتيح ووكومرس — أعد إدخال المفاتيح", res.status, "unauthorized", true);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt, 20) * 1000 + 500);
    return wcGet<T>(cred, path, params, attempt + 1);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    throw new WooError(body.message || `WooCommerce ${res.status}`, res.status, body.code);
  }
  const rows = (await res.json().catch(() => [])) as T[];
  const totalPages = Number(res.headers.get("x-wp-totalpages")) || 1;
  return { rows: Array.isArray(rows) ? rows : [], totalPages };
}

/**
 * Page through a WC collection (per_page=100). `params` is merged into every request.
 * Bounded to 200 pages (20k rows) — a runaway-cursor guard, plenty for a single store.
 */
export async function wcPaginate<T>(cred: Credential, path: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const { rows, totalPages } = await wcGet<T>(cred, path, { ...params, per_page: 100, page });
    out.push(...rows);
    if (page >= totalPages || rows.length === 0) break;
  }
  return out;
}
