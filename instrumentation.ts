export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on missing required env (DATABASE_URL / AUTH_SECRET).
    const { validateEnv } = await import("@/lib/env");
    validateEnv();
  }
}
