import "server-only";
import type { Credential } from "../connector";
import { getShopifyConfig } from "@/lib/saas/shopify-config";
import { adminGraphqlUrl, validateShop } from "./constants";

// Shopify Admin GraphQL client. Per-shop: the shop domain is cred.sellerId and the
// permanent Admin access token is cred.refreshToken (no refresh — Shopify OAuth
// tokens don't expire). Handles GraphQL errors, auth failures, and cost-based
// throttling (Shopify returns 200 + errors[THROTTLED] with a leaky-bucket status).

export class ShopifyError extends Error {
  constructor(message: string, public status: number, public code?: string, public isAuth = false) {
    super(message);
    this.name = "ShopifyError";
  }
}

/** True when the failure means the store's access token is revoked/invalid. */
export function isShopifyAuthError(e: unknown): boolean {
  return e instanceof ShopifyError && e.isAuth;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const API_TIMEOUT_MS = 30_000;

type GqlResponse<T> = {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
};

/**
 * Run a GraphQL query against the store. Retries throttled calls (up to 6) by
 * waiting for the leaky bucket to refill; surfaces auth errors as ShopifyError
 * with isAuth so coreFail flags needsReauth.
 */
export async function shopifyGraphql<T>(cred: Credential, query: string, variables?: Record<string, unknown>, attempt = 0): Promise<T> {
  const shop = validateShop(cred.sellerId || "");
  if (!shop) throw new ShopifyError("دومين متجر شوبيفاي غير صالح", 400, "invalid_shop");
  const cfg = await getShopifyConfig();
  const version = cfg?.apiVersion; // undefined → adminGraphqlUrl uses the default

  const res = await fetch(adminGraphqlUrl(shop, version), {
    method: "POST",
    headers: { "X-Shopify-Access-Token": cred.refreshToken, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ query, variables: variables ?? {} }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ShopifyError("انتهت صلاحية ربط شوبيفاي — أعد ربط المتجر", res.status, "unauthorized", true);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.random() * Math.min(2 ** attempt, 30) * 1000 + 500);
    return shopifyGraphql<T>(cred, query, variables, attempt + 1);
  }

  const json = (await res.json().catch(() => ({}))) as GqlResponse<T>;
  const throttled = json.errors?.some((e) => e.extensions?.code === "THROTTLED");
  if (throttled && attempt < 6) {
    const ts = json.extensions?.cost?.throttleStatus;
    const waitMs = ts && ts.restoreRate > 0 ? Math.min((1000 / ts.restoreRate) * 1000, 10_000) : 2_000;
    await sleep(waitMs);
    return shopifyGraphql<T>(cred, query, variables, attempt + 1);
  }
  if (json.errors?.length) {
    const first = json.errors[0];
    const auth = first.extensions?.code === "ACCESS_DENIED" || first.extensions?.code === "UNAUTHORIZED";
    throw new ShopifyError(first.message, res.status || 200, first.extensions?.code, auth);
  }
  if (!res.ok || !json.data) throw new ShopifyError(`Shopify ${res.status}`, res.status);
  return json.data;
}

/** Cursor-paginate a `connection` field. `extract` maps one page's data to its
 *  `{ nodes, pageInfo }` connection; accumulates nodes across pages. */
export async function paginate<Node, Data>(
  cred: Credential,
  query: string,
  variables: Record<string, unknown>,
  extract: (d: Data) => { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } },
): Promise<Node[]> {
  const out: Node[] = [];
  let cursor: string | null = null;
  // Bounded loop — 200 pages × 50 = 10k listings/orders is plenty; guards a runaway cursor.
  for (let i = 0; i < 200; i++) {
    const data = await shopifyGraphql<Data>(cred, query, { ...variables, cursor });
    const conn = extract(data);
    out.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    cursor = conn.pageInfo.endCursor;
  }
  return out;
}
