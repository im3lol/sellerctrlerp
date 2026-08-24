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
// Throttle: at most one alert per distinct throttle key per minute, so an error LOOP (the
// worst case: a failing job retried every few seconds) can't flood the channel. The key is
// the event name, PLUS the org id when the event carries one — so a fleet-wide failure
// (e.g. Amazon revoking many tenants' tokens at once) still pages once PER org instead of
// collapsing every tenant into a single event-name bucket and silencing all but the first.
const lastAlert = new Map<string, number>();
function forward(level: Level, event: string, line: string, throttleKey: string): void {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHAT_ID;
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url && !(tgToken && tgChat)) return;

  const now = Date.now();
  const prev = lastAlert.get(throttleKey);
  if (prev && now - prev < 60_000) return;
  lastAlert.set(throttleKey, now);

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
  // Per-org throttle key when the event carries an orgId (see forward()); else by event name.
  const orgId = ctx && typeof ctx.orgId === "string" ? ctx.orgId : undefined;
  const throttleKey = orgId ? `${event}:${orgId}` : event;
  if (level === "error") { console.error(line); forward(level, event, line, throttleKey); }
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  error: (event: string, ctx?: Record<string, unknown>) => emit("error", event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit("warn", event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit("info", event, ctx),
};
