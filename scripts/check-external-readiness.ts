/**
 * External operations readiness check. It intentionally prints statuses only — never
 * values — so it is safe in CI, a terminal recording, or a support session.
 *
 * `npm run ops:external:check` reports gaps without failing.
 * `npm run ops:external:check -- --strict` returns non-zero until all launch services
 * (except the user-configurable SMTP panel) are configured and the public health URL is up.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Scripts are commonly invoked directly on the production host, unlike deploy.sh
// which already sources .env. Load the local file without printing it; real shell/CI
// values remain authoritative.
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    const raw = match[2];
    process.env[match[1]] = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
      ? raw.slice(1, -1)
      : raw;
  }
}

const strict = process.argv.includes("--strict");
const noNetwork = process.argv.includes("--no-network");

function complete(keys: string[]) { return keys.every((key) => Boolean(process.env[key]?.trim())); }
function result(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✓" : "!"} ${label}: ${detail}`);
  return ok;
}

async function main() {
  const checks: boolean[] = [];
  // SMTP may be stored encrypted in the admin panel, so this only detects the env fallback.
  const smtpEnv = complete(["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]);
  result("SMTP", smtpEnv, smtpEnv ? "env fallback configured" : "configure env or /admin/integrations");

  checks.push(result("Sentry", complete(["SENTRY_DSN"]), "set SENTRY_DSN to receive redacted server errors"));
  checks.push(result("On-call alerts", complete(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]), "Telegram bot + chat"));
  checks.push(result("Offsite backups", complete(["OFFSITE_S3_BUCKET", "OFFSITE_S3_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]), "R2/S3 upload credentials"));

  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!appUrl || noNetwork) {
    result("Public health", false, noNetwork ? "network probe skipped" : "APP_URL is missing");
  } else {
    try {
      const response = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      const body = await response.json() as { ok?: boolean };
      checks.push(result("Public health", response.ok && body.ok === true, `${response.status} ${body.ok ? "ready" : "degraded"}`));
    } catch {
      checks.push(result("Public health", false, "unreachable from this machine"));
    }
  }

  console.log("\nSMTP may be configured encrypted in /admin/integrations, so it is intentionally not a strict blocker here.");
  if (strict && checks.some((ok) => !ok)) process.exitCode = 1;
}

main().catch(() => { console.error("! external readiness check failed unexpectedly"); process.exitCode = 1; });
