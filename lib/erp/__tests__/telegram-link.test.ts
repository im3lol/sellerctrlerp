import { describe, it, expect, beforeEach } from "vitest";
import { linkPayload, verifyLinkPayload } from "@/lib/erp/telegram";

const id = "9f578857-1234-4abc-8def-0123456789ab";

describe("telegram link payload", () => {
  beforeEach(() => { process.env.TELEGRAM_BOT_TOKEN = "123:test-token"; });

  it("round-trips a membership id within Telegram's 64-char [A-Za-z0-9_-] limit", () => {
    const p = linkPayload(id);
    expect(p.length).toBeLessThanOrEqual(64);
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifyLinkPayload(p)).toBe(id);
  });

  it("rejects an expired link", () => {
    expect(verifyLinkPayload(linkPayload(id, Date.now() - 16 * 60_000))).toBeNull();
  });

  it("rejects a link pointing at someone else's membership", () => {
    const p = linkPayload(id);
    expect(verifyLinkPayload("0" + p.slice(1))).toBeNull();
  });

  it("rejects a link signed with another bot's token", () => {
    const p = linkPayload(id);
    process.env.TELEGRAM_BOT_TOKEN = "999:other";
    expect(verifyLinkPayload(p)).toBeNull();
  });
});
