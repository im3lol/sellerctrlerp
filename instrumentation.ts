export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on missing required env (DATABASE_URL / AUTH_SECRET).
    const { validateEnv } = await import("@/lib/env");
    validateEnv();

    // Worker container only (WORKER=1): boot the BullMQ sync workers. The web
    // container leaves this unset and never processes jobs (only enqueues them).
    if (process.env.WORKER === "1" && process.env.REDIS_URL) {
      const { startWorkers } = await import("@/lib/queue/worker");
      startWorkers();
    }
  }
}
