import { z } from "zod";

/**
 * Validates required environment variables at boot so misconfiguration fails
 * loudly and early instead of as obscure errors deep in a request.
 */
const requiredSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL مطلوب (سلسلة اتصال Postgres)"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET مطلوب (npx auth secret)"),
});

// Present-only-when-the-feature-is-used. Missing → warn, don't crash.
const OPTIONAL = [
  "SUPABASE_URL", // item-image storage (Supabase Storage backend on Vercel)
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_BUCKET",
  "CRON_SECRET", // Vercel cron endpoint auth
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
