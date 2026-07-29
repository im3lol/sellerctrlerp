import "server-only";
import type { OAuthExchange } from "../connector";
import type { OAuthState } from "../oauth-state";
import { getShopifyConfig } from "@/lib/saas/shopify-config";
import { authorizeUrlFor, tokenUrl, validateShop, shopifyHmacValid, SHOPIFY_SCOPES, SHOPIFY_REGION } from "./constants";

// Shopify OAuth (public app). Shop-domain-first: the merchant's shop is the `target`
// carried in the signed state (state.marketplace). The callback is HMAC-signed by
// Shopify with the app secret — we verify it before exchanging the code.

/** Build the consent URL for a shop. null → app not configured, no APP_URL, or
 *  invalid shop (the connect route renders the Arabic "setup" error on null). */
export async function authorizeUrl(state: string, shop: string): Promise<string | null> {
  const clean = validateShop(shop);
  const appUrl = process.env.APP_URL;
  if (!clean || !appUrl) return null;
  const cfg = await getShopifyConfig();
  if (!cfg) return null;
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/erp/marketplace/shopify/callback`;
  return authorizeUrlFor(clean, { clientId: cfg.clientId, scope: SHOPIFY_SCOPES, redirectUri, state });
}

/** Exchange the auth code for a permanent Admin API access token (per-shop endpoint). */
export async function exchangeCode(code: string, _redirectUri: string, shop?: string): Promise<OAuthExchange> {
  const clean = validateShop(shop || "");
  if (!clean) return { error: "دومين المتجر غير صالح" };
  const cfg = await getShopifyConfig();
  if (!cfg) return { error: "تطبيق شوبيفاي غير مُعدّ — أدخل مفاتيحه في الإعدادات" };
  const res = await fetch(tokenUrl(clean), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    cache: "no-store",
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !json.access_token) return { error: json.error_description || json.error || "تعذّر إتمام ربط شوبيفاي" };
  return { refreshToken: json.access_token }; // Shopify token is permanent; stored where refreshToken lives
}

/**
 * Verify Shopify's callback HMAC and extract the code + shop. Shopify signs the
 * query: sort all params except `hmac`/`signature` as `key=value` joined by `&`,
 * HMAC-SHA256 with the app secret (hex), compare to `hmac`. Also confirm the shop
 * matches the one the seller started from (anti shop-swap).
 */
export async function verifyCallback(params: URLSearchParams, state: OAuthState) {
  const cfg = await getShopifyConfig();
  if (!cfg) return { error: "تطبيق شوبيفاي غير مُعدّ" };
  const shop = params.get("shop");
  const code = params.get("code");
  if (!shop || !code) return { error: "استجابة شوبيفاي ناقصة" };

  if (!shopifyHmacValid(params, cfg.clientSecret)) return { error: "توقيع شوبيفاي غير صالح" };
  if (validateShop(shop) !== validateShop(state.marketplace)) return { error: "متجر غير مطابق لطلب الربط" };
  return { code, sellerId: validateShop(shop), marketplaceId: null, region: SHOPIFY_REGION };
}
