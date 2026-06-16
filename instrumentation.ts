export async function register() {
  // Only run background jobs in the Node.js server runtime (not edge).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startCron } = await import("@/lib/cron");
    startCron();
  }
}
