/**
 * Deployment preflight. It deliberately prints only variable names, never values.
 * Run by scripts/deploy.sh before a production build or directly with npm run env:production:check.
 */
const insecureValues = new Set([
  "sellerctrl",
  "appuser",
  "minioadmin",
  "replace-me-with-a-long-random-string",
  "replace-with-a-long-random-string",
]);

const secretKeys = [
  "AUTH_SECRET",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
  "POSTGRES_PASSWORD",
  "APPUSER_PASSWORD",
  "MINIO_ROOT_PASSWORD",
  "S3_SECRET_KEY",
] as const;
const requiredKeys = [...secretKeys, "MINIO_ROOT_USER", "S3_ACCESS_KEY", "REDIS_URL", "S3_ENDPOINT", "S3_BUCKET"] as const;

const problems: string[] = [];
for (const key of requiredKeys) {
  if (!process.env[key]) problems.push(`${key} is missing`);
}
for (const key of secretKeys) {
  const value = process.env[key];
  if (value && (value.length < 32 || insecureValues.has(value))) problems.push(`${key} is weak or a known default`);
}
for (const key of ["MINIO_ROOT_USER", "S3_ACCESS_KEY"] as const) {
  if (process.env[key] && insecureValues.has(process.env[key]!)) problems.push(`${key} is a known default`);
}

if (problems.length) {
  console.error("Production environment preflight failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log("Production environment preflight passed.");
