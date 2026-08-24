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

describe("external error sink (ERROR_WEBHOOK_URL) — dep-free Sentry stand-in", () => {
  it("no-ops when unset, POSTs the error payload when set", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));

    delete process.env.ERROR_WEBHOOK_URL;
    log.error("x");
    expect(fetchSpy).not.toHaveBeenCalled(); // unset → no external call

    process.env.ERROR_WEBHOOK_URL = "https://hook.example/ingest";
    log.error("y", { orgId: "o1" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe("https://hook.example/ingest");
    delete process.env.ERROR_WEBHOOK_URL;
  });

  it("warn/info never hit the external sink (only errors alert)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
    process.env.ERROR_WEBHOOK_URL = "https://hook.example/ingest";
    log.warn("noise");
    expect(fetchSpy).not.toHaveBeenCalled();
    delete process.env.ERROR_WEBHOOK_URL;
  });
});
