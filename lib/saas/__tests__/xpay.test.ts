import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, toMinorUnits, fromMinorUnits, isCompleteStatus } from "../xpay";

const SECRET = "whsec_test_123";
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_1", status: "complete" } } });
  const now = 1_730_000_000;

  it("accepts a correctly signed, in-window request", () => {
    expect(verifyWebhookSignature(body, sign(body, now), SECRET, now)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + "x", sign(body, now), SECRET, now)).toBe(false);
  });
  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, now, "whsec_other"), SECRET, now)).toBe(false);
  });
  it("rejects a stale timestamp (replay outside tolerance)", () => {
    expect(verifyWebhookSignature(body, sign(body, now), SECRET, now + 400)).toBe(false);
  });
  it("rejects a missing/garbage header", () => {
    expect(verifyWebhookSignature(body, null, SECRET, now)).toBe(false);
    expect(verifyWebhookSignature(body, "nonsense", SECRET, now)).toBe(false);
  });
});

describe("minor units", () => {
  it("EGP → piasters and back", () => {
    expect(toMinorUnits(1499)).toBe(149900);
    expect(fromMinorUnits(149900)).toBe(1499);
    expect(toMinorUnits(50.5)).toBe(5050);
  });
});

describe("isCompleteStatus", () => {
  it("only 'complete' (case-insensitive) counts", () => {
    expect(isCompleteStatus("complete")).toBe(true);
    expect(isCompleteStatus("Complete")).toBe(true);
    for (const s of ["open", "expired", "", null, undefined]) expect(isCompleteStatus(s)).toBe(false);
  });
});
