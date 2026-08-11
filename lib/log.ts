import "server-only";

// Minimal structured logger — one JSON line per event so a VPS log shipper (Loki,
// CloudWatch, `docker logs | jq`) can parse + alert on it, and background-job failures
// stop being swallowed by empty catches. Dependency-free; to forward errors to Sentry
// or similar later, add the sink here behind an env flag — call sites don't change.
type Level = "error" | "warn" | "info";

// Optional external error sink — dep-free stand-in for Sentry. Two channels, both
// fire-and-forget so a failure alerts the owner instead of only sitting in `docker logs`:
//   • Telegram  — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (instant push to the phone)
//   • Generic   — set ERROR_WEBHOOK_URL (Slack/Sentry/any webhook; receives the raw JSON)
// Unset → no-op. Never throws, never blocks the request.
//
// Throttle: at most one alert per distinct event name per minute, so an error LOOP (the
// worst case: a failing job retried every few seconds) can't flood the channel. The map
// is bounded by the fixed set of event-name string literals in the codebase.
const lastAlert = new Map<string, number>();
function forward(level: Level, event: string, line: string): void {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url && !(tgToken && tgChat)) return;

  const now = Date.now();
  const prev = lastAlert.get(event);
  if (prev && now - prev < 60_000) return;
  lastAlert.set(event, now);

  if (tgToken && tgChat) {
    const text = `🔴 SellerCtrl [${level}] ${event}\n${line.slice(0, 3500)}`;
    void fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: tgChat, text, disable_web_page_preview: true }),
    }).catch(() => {});
  }
  if (url) {
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: line })
      .catch(() => {}); // alerting must never break the app
  }
}

function emit(level: Level, event: string, ctx?: Record<string, unknown>): void {
  const out: Record<string, unknown> = { t: new Date().toISOString(), level, event };
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
    }
  }
  const line = JSON.stringify(out);
  if (level === "error") { console.error(line); forward(level, event, line); }
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
};
