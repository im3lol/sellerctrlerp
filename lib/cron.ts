import cron from "node-cron";
import { syncAllDue } from "@/lib/sync";
import { runDueRecurrences } from "@/lib/recurring";

const globalForCron = globalThis as unknown as { __cronStarted?: boolean };

/** Start background jobs once per process (called from instrumentation.ts). */
export function startCron() {
  if (globalForCron.__cronStarted) return;
  globalForCron.__cronStarted = true;

  // Google Sheets auto-sync every 5 minutes (§7).
  cron.schedule("*/5 * * * *", async () => {
    try {
      await syncAllDue();
    } catch (e) {
      console.error("[cron] sheets sync failed", e);
    }
  });

  // Recurring task generation, hourly (§14).
  cron.schedule("0 * * * *", async () => {
    try {
      await runDueRecurrences();
    } catch (e) {
      console.error("[cron] recurring tasks failed", e);
    }
  });

  console.log("[cron] background jobs scheduled");
}
