import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureSentryError } from "@/lib/observability/sentry";

const originalDsn = process.env.SENTRY_DSN;
const originalFetch = global.fetch;

describe("Sentry error sink", () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/42";
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    process.env.SENTRY_DSN = originalDsn;
    global.fetch = originalFetch;
  });

  it("uses the Sentry envelope endpoint and redacts secret-like context", () => {
    captureSentryError({ event: "queue.failed", line: JSON.stringify({ password: "do-not-send", databaseUrl: "postgres://user:pass@db/app" }) });

    expect(global.fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(global.fetch).mock.calls[0]!;
    expect(url).toBe("https://example.ingest.sentry.io/api/42/envelope/");
    expect(String(init?.body)).toContain("[redacted]");
    expect(String(init?.body)).not.toContain("do-not-send");
    expect(String(init?.body)).not.toContain("postgres://user:pass@db/app");
  });
});
