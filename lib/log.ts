import "server-only";

// Minimal structured logger — one JSON line per event so a VPS log shipper (Loki,
// CloudWatch, `docker logs | jq`) can parse + alert on it, and background-job failures
// stop being swallowed by empty catches. Dependency-free; to forward errors to Sentry
// or similar later, add the sink here behind an env flag — call sites don't change.
type Level = "error" | "warn" | "info";

// Optional external error sink — dep-free stand-in for Sentry. If ERROR_WEBHOOK_URL is
// set (a Sentry/Slack/webhook ingest URL), error events are POSTed there fire-and-forget
// so the team is alerted instead of the failure only sitting in `docker logs`. Unset →
// no-op. Never throws, never blocks the request.
function forward(payload: string): void {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload })
    .catch(() => {}); // alerting must never break the app
}

function emit(level: Level, event: string, ctx?: Record<string, unknown>): void {
  const out: Record<string, unknown> = { t: new Date().toISOString(), level, event };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
    }
  }
  const line = JSON.stringify(out);
  if (level === "error") { console.error(line); forward(line); }
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
};
