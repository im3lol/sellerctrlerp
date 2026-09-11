import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

/**
 * The webhook is the only thing that turns a payment into an active subscription. It
 * used to swallow a settle failure and answer 200, which tells xpay "recorded" and stops
 * its retries — a customer could pay and never be activated, with nothing logged. These
 * pin the contract: a failed settle is a 500 (so xpay retries) and an alert.
 */

const SECRET = "whsec_test_123";
const settle = vi.fn();
const logError = vi.fn();

vi.mock("@/lib/saas/xpay-settle", () => ({ settleXpaySession: (...a: unknown[]) => settle(...a) }));
vi.mock("@/lib/log", () => ({ log: { error: (...a: unknown[]) => logError(...a), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/saas/xpay", async () => {
  const real = await vi.importActual<typeof import("@/lib/saas/xpay")>("@/lib/saas/xpay");
  return { ...real, getXpayConfig: async () => ({ webhookSecret: SECRET }) };
});

import { POST } from "@/app/api/subscription/xpay/webhook/route";

const body = JSON.stringify({
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", status: "complete", amountTotal: 149900, metadata: { subscription_request_id: "req_1" } } },
});
const signed = (raw: string, secret = SECRET) => {
  const t = Math.floor(Date.now() / 1000);
  return new Request("http://x/api/subscription/xpay/webhook", {
    method: "POST",
    body: raw,
    headers: { "XPay-Signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}` },
  });
};

beforeEach(() => { settle.mockReset(); logError.mockReset(); });

describe("xpay webhook", () => {
  it("answers 500 and alerts when settling fails, so xpay retries", async () => {
    settle.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(signed(body));
    expect(res.status).toBe(500);
    expect(logError).toHaveBeenCalledWith("xpay.settle_failed", expect.objectContaining({ sessionId: "cs_1", requestId: "req_1" }));
  });

  it("answers 200 once the payment is settled", async () => {
    settle.mockResolvedValueOnce(undefined);
    const res = await POST(signed(body));
    expect(res.status).toBe(200);
    expect(settle).toHaveBeenCalledOnce();
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects a bad signature without touching the subscription", async () => {
    const res = await POST(signed(body, "whsec_wrong"));
    expect(res.status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
  });
});
