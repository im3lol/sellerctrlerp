import { z } from "zod";

/**
 * Validates required environment variables at boot so misconfiguration fails
 * loudly and early instead of as obscure errors deep in a request.
 */
const requiredSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL مطلوب (سلسلة اتصال Postgres)"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET مطلوب (npx auth secret)"),
});

// Present-only-when-the-feature-is-used. Missing → warn, don't crash (so a partial
// deployment still boots), but surfaced loudly instead of failing deep in a request.
const OPTIONAL = [
  "ENCRYPTION_KEY", // dedicated secret-at-rest key; falls back to AUTH_SECRET if unset
  "REDIS_URL", // BullMQ queues — required for the worker + scheduled sync
  "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", // object storage (uploads/backups)
  "SMTP_HOST", // transactional email (also configurable in /admin/integrations)
  "CRON_SECRET", // scheduled-jobs endpoint auth (the compose cron sidecar)
  "NOON_WEBHOOK_SECRET", // Noon order webhook shared secret (mandatory once Noon is live)
] as const;

const INSECURE_PRODUCTION_VALUES = new Set([
  "sellerctrl",
  "appuser",
  "minioadmin",
  "replace-me-with-a-long-random-string",
  "replace-with-a-long-random-string",
]);

const PRODUCTION_SECRET_KEYS = ["AUTH_SECRET", "ENCRYPTION_KEY", "CRON_SECRET", "S3_SECRET_KEY"] as const;

function productionEnvProblems(): string[] {
  const problems: string[] = [];
  const required = ["ENCRYPTION_KEY", "CRON_SECRET", "REDIS_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
  for (const key of required) {
    if (!process.env[key]) problems.push(`${key} مطلوب في production`);
  }
  for (const key of PRODUCTION_SECRET_KEYS) {
    const value = process.env[key];
    if (value && (value.length < 32 || INSECURE_PRODUCTION_VALUES.has(value))) {
      problems.push(`${key} يجب أن يكون سرًا عشوائيًا بطول 32 حرفًا على الأقل`);
    }
  }
  try {
    const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
    const password = decodeURIComponent(databaseUrl.password);
    if (!password || password.length < 32 || INSECURE_PRODUCTION_VALUES.has(password)) {
      problems.push("DATABASE_URL يجب أن يحتوي على كلمة مرور قوية وغير افتراضية");
    }
  } catch {
    problems.push("DATABASE_URL غير صالح");
  }
  return problems;
}

export function validateEnv(): void {
  const parsed = requiredSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(" · ");
    throw new Error(`[env] إعدادات بيئة مطلوبة ناقصة: ${msg}`);
  }
  if (process.env.NODE_ENV === "production") {
    const problems = productionEnvProblems();
    if (problems.length) throw new Error(`[env] إعدادات production غير آمنة: ${problems.join(" · ")}`);
  }
  for (const key of OPTIONAL) {
    if (!process.env[key]) console.warn(`[env] متغير اختياري غير مضبوط: ${key} (الميزة المرتبطة به قد لا تعمل)`);
  }
}
