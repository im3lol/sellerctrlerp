import { describe, it, expect, vi, afterEach } from "vitest";
import { log } from "../log";

afterEach(() => vi.restoreAllMocks());

describe("log — structured JSON, error serialization", () => {
  it("emits one parseable JSON line with level + event + context", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.warn("cron.backup_failed", { orgId: "org_1" });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "warn", event: "cron.backup_failed", orgId: "org_1" });
    expect(typeof parsed.t).toBe("string");
  });

  it("serializes an Error into { message, stack } instead of {}", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("job.failed", { err: new Error("boom") });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.err.message).toBe("boom");
    expect(typeof parsed.err.stack).toBe("string");
  });
});
