import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";

/**
 * xpay (xpay.app) — platform-level payment gateway for SaaS subscription checkout.
 * ONE owner account for the whole platform. It's a Stripe-style API: Bearer secret
 * key, a hosted Checkout Session (POST /checkout/sessions → a URL the tenant pays on),
 * and a signed webhook (checkout.session.completed) that is the ONLY thing we trust to
 * activate a subscription — never the redirect.
 *
 * Config is read from the DB (set by the owner in /admin/integrations), with env vars
 * as a fallback. Nothing is hard-coded and there are no per-tenant keys.
 */

export type XpayConfig = { secretKey: string; publishableKey: string; webhookSecret: string; baseUrl: string };

/** Resolve gateway config: DB singleton first (secrets decrypted), else env. null = not configured. */
export async function getXpayConfig(): Promise<XpayConfig | null> {
  let row: typeof platformSettings.$inferSelect | undefined;
  try { [row] = await db.select().from(platformSettings).limit(1); } catch { row = undefined; } // table may predate migration
  const secretKey = (row?.xpaySecretKey ? decryptSecret(row.xpaySecretKey) : "") || process.env.XPAY_SECRET_KEY || "";
  const publishableKey = row?.xpayPublishableKey || process.env.XPAY_PUBLISHABLE_KEY || "";
  const webhookSecret = (row?.xpayWebhookSecret ? decryptSecret(row.xpayWebhookSecret) : "") || process.env.XPAY_WEBHOOK_SECRET || "";
  const baseUrl = (row?.xpayBaseUrl || process.env.XPAY_BASE_URL || "https://api.xpay.app").replace(/\/$/, "");
  if (!secretKey) return null; // the secret key alone is enough to create a checkout; webhook secret needed to verify
  return { secretKey, publishableKey, webhookSecret, baseUrl };
}

export async function xpayConfigured(): Promise<boolean> {
  return !!(await getXpayConfig());
}

async function requireCfg(): Promise<XpayConfig> {
  const cfg = await getXpayConfig();
  if (!cfg) throw new Error("بوابة xpay غير مُعدّة");
  return cfg;
}

/** EGP → minor units (piasters). xpay amounts are integers in the currency's smallest unit. */
export const toMinorUnits = (amount: number) => Math.round(amount * 100);
export const fromMinorUnits = (minor: number) => Math.round(minor) / 100;

export type CheckoutSession = { id: string; url: string; clientSecret: string; status: string; amountTotal: number; currency: string };

/**
 * Create a checkout session. Hosted (default) returns a `url` to redirect to;
 * `uiMode:"embedded"` (drop-in) returns a `clientSecret` the client SDK opens in a
 * modal on our own domain. `redirectUrl` may contain the literal {CHECKOUT_SESSION_ID}
 * placeholder — xpay substitutes the real id on return.
 */
export async function createCheckoutSession(input: {
  amount: number; currency?: string; name: string; redirectUrl: string; metadata?: Record<string, string>; uiMode?: "embedded" | "custom";
}): Promise<CheckoutSession> {
  const cfg = await requireCfg();
  const currency = input.currency ?? "EGP";
  const res = await fetch(`${cfg.baseUrl}/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.secretKey}`, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      ...(input.uiMode ? { uiMode: input.uiMode } : {}),
      afterCompletion: { type: "redirect", redirect: { url: input.redirectUrl } },
      currency,
      lineItems: [{ quantity: 1, priceData: { currency, unitAmount: toMinorUnits(input.amount), productData: { name: input.name } } }],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  });
  const json = await res.json().catch(() => ({}));
  const ok = res.ok && (json?.url || json?.clientSecret);
  if (!ok) throw new Error(`xpay ${res.status}: ${json?.error?.message || json?.message || "تعذّر إنشاء جلسة الدفع"}`);
  return { id: json.id, url: json.url ?? "", clientSecret: json.clientSecret ?? "", status: json.status, amountTotal: json.amountTotal, currency: json.currency };
}

/** Retrieve a checkout session to confirm its status server-side (used on the return redirect). */
export async function getCheckoutSession(id: string): Promise<CheckoutSession | null> {
  const cfg = await requireCfg();
  const res = await fetch(`${cfg.baseUrl}/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${cfg.secretKey}` }, cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return json ? { id: json.id, url: json.url ?? "", clientSecret: json.clientSecret ?? "", status: json.status, amountTotal: json.amountTotal, currency: json.currency } : null;
}

export const isCompleteStatus = (s: string | null | undefined) => String(s || "").toLowerCase() === "complete";

/**
 * Verify an `XPay-Signature: t=<ts>,v1=<hmac>` header against the raw request body.
 * Pure: HMAC-SHA256 over `${t}.${rawBody}` with the whsec, timing-safe compare, plus a
 * replay window. `nowSec`/`toleranceSec` are injectable so it's unit-testable.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=").map((s) => s.trim())) as [string, string][]);
  const t = Number(parts.t), v1 = parts.v1;
  if (!t || !v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
