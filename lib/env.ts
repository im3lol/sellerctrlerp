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
  "SUPABASE_URL", // item-image storage (Supabase Storage backend on Vercel)
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_BUCKET",
  "SMTP_HOST", // transactional email (also configurable in /admin/integrations)
  "CRON_SECRET", // scheduled-jobs endpoint auth (Vercel Cron / VPS cron sidecar)
  "NOON_WEBHOOK_SECRET", // Noon order webhook shared secret (mandatory once Noon is live)
] as const;

export function validateEnv(): void {
  const parsed = requiredSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(" · ");
    throw new Error(`[env] إعدادات بيئة مطلوبة ناقصة: ${msg}`);
  }
  for (const key of OPTIONAL) {
    if (!process.env[key]) console.warn(`[env] متغير اختياري غير مضبوط: ${key} (الميزة المرتبطة به قد لا تعمل)`);
  }
}
