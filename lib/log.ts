import "server-only";

// Minimal structured logger — one JSON line per event so a VPS log shipper (Loki,
// CloudWatch, `docker logs | jq`) can parse + alert on it, and background-job failures
// stop being swallowed by empty catches. Dependency-free; to forward errors to Sentry
// or similar later, add the sink here behind an env flag — call sites don't change.
type Level = "error" | "warn" | "info";

function emit(level: Level, event: string, ctx?: Record<string, unknown>): void {
  const out: Record<string, unknown> = { t: new Date().toISOString(), level, event };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
    }
  }
  const line = JSON.stringify(out);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
};
