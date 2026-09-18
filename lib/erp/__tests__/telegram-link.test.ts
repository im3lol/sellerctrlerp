import { describe, it, expect, beforeEach } from "vitest";
import { linkPayloadForToken, verifyLinkPayloadForToken } from "@/lib/erp/telegram";

const id = "9f578857-1234-4abc-8def-0123456789ab";

describe("telegram link payload", () => {
  let token = "123:test-token";
  beforeEach(() => { token = "123:test-token"; });

  it("round-trips a membership id within Telegram's 64-char [A-Za-z0-9_-] limit", () => {
    const p = linkPayloadForToken(token, id);
    expect(p.length).toBeLessThanOrEqual(64);
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyLinkPayloadForToken(token, p)).toBe(id);
  });

  it("rejects an expired link", () => {
    expect(verifyLinkPayloadForToken(token, linkPayloadForToken(token, id, Date.now() - 16 * 60_000))).toBeNull();
  });

  it("rejects a link pointing at someone else's membership", () => {
    const p = linkPayloadForToken(token, id);
    expect(verifyLinkPayloadForToken(token, "0" + p.slice(1))).toBeNull();
  });

  it("rejects a link signed with another bot's token", () => {
    const p = linkPayloadForToken(token, id);
    token = "999:other";
    expect(verifyLinkPayloadForToken(token, p)).toBeNull();
  });
});
