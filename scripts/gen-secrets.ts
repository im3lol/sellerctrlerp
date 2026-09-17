/**
 * Generate strong random secrets for a rotation. Prints values only — never writes
 * .env or touches any provider (rotating the Amazon/Supabase secrets themselves is a
 * console action only the account owner can do). See docs/SECRET-ROTATION.md.
 *
 *   npm run gen:secrets
 */
import { randomBytes } from "node:crypto";

const key = () => randomBytes(32).toString("base64url"); // 256-bit
const minioUser = "sellerctrl-minio";
const minioPassword = key();

console.log(`AUTH_SECRET=${key()}`);
console.log(`ENCRYPTION_KEY=${key()}`);
console.log(`CRON_SECRET=${key()}`);
console.log(`NOON_WEBHOOK_SECRET=${key()}`);
console.log(`INIT_SETUP_TOKEN=${key()}`);
console.log(`POSTGRES_PASSWORD=${key()}`);
console.log(`APPUSER_PASSWORD=${key()}`);
console.log(`MINIO_ROOT_USER=${minioUser}`);
console.log(`MINIO_ROOT_PASSWORD=${minioPassword}`);
console.log(`S3_ACCESS_KEY=${minioUser}`);
console.log(`S3_SECRET_KEY=${minioPassword}`);
console.log("\n# Paste these into the deployment host's .env (or its secrets store),");
console.log("# NOT a committed file. Rotating AUTH_SECRET invalidates sessions; keeping the");
console.log("# OLD AUTH_SECRET as the ENCRYPTION_KEY fallback would still decrypt existing");
console.log("# marketplace tokens — set ENCRYPTION_KEY to the OLD AUTH_SECRET first, deploy,");
console.log("# then rotate AUTH_SECRET, so stored tokens/MFA secrets keep decrypting.");
