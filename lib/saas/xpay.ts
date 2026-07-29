import "server-only";

/**
 * xpay (xpay.app) — platform-level payment gateway for SaaS subscription checkout.
 * ONE owner account for the whole platform (not per-tenant): creds come from env, no
 * hard-coding. Flow: prepareAmount (fees) → createPayment (returns an iframe URL the
 * tenant pays in) → getTransaction (server-side verify before we activate anything).
 * We never trust the async callback body — always re-read the transaction here.
 *
 * Dashboard setup (manual, once): create an "API Payment" → get variable_amount_id,
 * set its Redirect URL = <APP_URL>/api/subscription/xpay/return and Callback URL =
 * <APP_URL>/api/subscription/xpay/callback. Put community_id / api_key / variable_amount_id
 * in env.
 */

const BASE = process.env.XPAY_BASE_URL || "https://staging.xpay.app/api/v1"; // staging by default; prod = https://community.xpay.app/api/v1
const API_KEY = process.env.XPAY_API_KEY || "";
const COMMUNITY_ID = process.env.XPAY_COMMUNITY_ID || "";
const VARIABLE_AMOUNT_ID = process.env.XPAY_VARIABLE_AMOUNT_ID || "";

export function xpayConfigured(): boolean {
  return !!(API_KEY && COMMUNITY_ID && VARIABLE_AMOUNT_ID);
}

/** xpay wraps every response as { status:{code,message,errors}, data:{...} }. Return
 *  data on a 2xx code, else throw a readable Arabic error built from status.errors. */
export function unwrapXpay<T>(json: unknown): T {
  const j = json as { status?: { code?: number; message?: string; errors?: unknown[] }; data?: T };
  const code = j?.status?.code ?? 0;
  if (code >= 200 && code < 300) return (j.data ?? {}) as T;
  const errs = Array.isArray(j?.status?.errors) ? JSON.stringify(j!.status!.errors) : "";
  throw new Error(`xpay ${code}: ${j?.status?.message || errs || "طلب فشل"}`);
}

// ponytail: exact success string is confirmed against staging on first live run — keep
// this set as the calibration knob rather than hard-coding one value.
const PAID = new Set(["SUCCESSFUL", "SUCCESS", "PAID", "COMPLETED"]);
export const isPaidStatus = (s: string | null | undefined): boolean => PAID.has(String(s || "").toUpperCase());

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ community_id: COMMUNITY_ID, ...body }),
    cache: "no-store",
  });
  return unwrapXpay<T>(await res.json());
}

export type XpayBilling = { name: string; email: string; phone: string };

/** Fees calculation: returns the total the tenant will actually be charged. */
export async function prepareAmount(amount: number, currency = "EGP", payUsing = "card"): Promise<number> {
  const data = await post<{ total_amount: number }>("/payments/prepare-amount/", {
    amount, currency, selected_payment_method: payUsing,
  });
  return Number(data.total_amount ?? amount);
}

/** Create a payment → the iframe the tenant completes + the transaction uuid we verify later. */
export async function createPayment(input: {
  amount: number; originalAmount: number; currency?: string; payUsing?: string; billing: XpayBilling; customFields?: { field_label: string; field_value: string }[];
}): Promise<{ iframeUrl: string; transactionUuid: string }> {
  const data = await post<{ iframe_url: string; transaction_uuid: string }>("/payments/pay/variable-amount", {
    variable_amount_id: Number(VARIABLE_AMOUNT_ID),
    amount: input.amount,
    original_amount: input.originalAmount,
    currency: input.currency ?? "EGP",
    pay_using: input.payUsing ?? "card",
    billing_data: { name: input.billing.name, email: input.billing.email, phone_number: input.billing.phone },
    ...(input.customFields ? { custom_fields: input.customFields } : {}),
  });
  return { iframeUrl: data.iframe_url, transactionUuid: data.transaction_uuid };
}

/** Authoritative status read — the only thing we trust before activating a subscription. */
export async function getTransaction(uuid: string): Promise<{ status: string; amount: number; currency: string }> {
  const res = await fetch(`${BASE}/communities/${encodeURIComponent(COMMUNITY_ID)}/transactions/${encodeURIComponent(uuid)}/`, {
    headers: { "x-api-key": API_KEY },
    cache: "no-store",
  });
  const data = unwrapXpay<{ status: string; total_amount: number; total_amount_currency: string }>(await res.json());
  return { status: data.status, amount: Number(data.total_amount ?? 0), currency: data.total_amount_currency || "EGP" };
}
