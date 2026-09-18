import "server-only";

/**
 * Tiny server-side Sentry envelope sender. Keeping this behind SENTRY_DSN means
 * observability is entirely opt-in: no account, SDK or network request is needed
 * for development and self-hosted installs that do not use Sentry.
 *
 * We deliberately send structured operational events only. Secret-looking fields
 * are removed before leaving the server, and delivery failures are ignored so an
 * error-monitoring outage can never affect an ERP request or a background job.
 */
const sensitiveKey = /pass(word)?|secret|token|authorization|cookie|api[_-]?key/i;
const sensitiveUrl = /(?:postgres(?:ql)?|redis):\/\/[^\s]+/gi;

function redact(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[redacted]";
  if (typeof value === "string") return value.replace(sensitiveUrl, "[redacted-url]");
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}

type ErrorEvent = { event: string; line: string };

/** Fire-and-forget reporting for `log.error`. */
export function captureSentryError({ event, line }: ErrorEvent): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.split("/").filter(Boolean).pop();
    if (!projectId || !parsed.username) return;

    let context: unknown = { raw: line };
    try { context = redact(JSON.parse(line)); } catch { /* keep safe fallback */ }

    const eventId = crypto.randomUUID().replaceAll("-", "");
    const sentAt = new Date().toISOString();
    const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/`;
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      JSON.stringify({
        event_id: eventId,
        timestamp: sentAt,
        platform: "node",
        level: "error",
        logger: "sellerctrl",
        message: event,
        extra: { context },
      }),
    ].join("\n");

    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body: `${envelope}\n`,
    }).catch(() => {});
  } catch {
    // An invalid DSN must never interfere with the primary failure path.
  }
}
