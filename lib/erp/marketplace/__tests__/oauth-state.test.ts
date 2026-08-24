import { describe, it, expect } from "vitest";
import { signState, verifyState } from "../oauth-state";

describe("OAuth state signing", () => {
  const payload = { orgId: "org_1", provider: "amazon", marketplace: "EG", ts: Date.now() };

  it("round-trips a valid state", () => {
    const got = verifyState(signState(payload));
    expect(got).toMatchObject({ orgId: "org_1", provider: "amazon", marketplace: "EG" });
  });

  it("rejects a tampered body", () => {
    const [, mac] = signState(payload).split(".");
    const tampered = Buffer.from(JSON.stringify({ ...payload, orgId: "org_evil" })).toString("base64url");
    expect(verifyState(`${tampered}.${mac}`)).toBeNull();
  });

  it("rejects a bad signature", () => {
    const t = signState(payload);
    expect(verifyState(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
  });

  it("rejects an expired state (>15 min)", () => {
    const old = signState({ ...payload, ts: Date.now() - 16 * 60 * 1000 });
    expect(verifyState(old)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyState("")).toBeNull();
    expect(verifyState("nodot")).toBeNull();
  });

  it("round-trips a no-target state (empty marketplace — Noon)", () => {
    // Noon has one consent screen and no marketplace/shop, so its state carries an
    // empty marketplace. verifyState must accept it (requiring it broke Noon OAuth).
    const got = verifyState(signState({ orgId: "org_1", provider: "NOON", marketplace: "", ts: Date.now() }));
    expect(got).toMatchObject({ orgId: "org_1", provider: "NOON", marketplace: "" });
  });
});
