import { runDueRecurrences } from "@/lib/recurring";
import { syncAllDue } from "@/lib/sync";
import { remindStaleProducts } from "@/lib/reminders";
import { isOnPremMode, performHeartbeat } from "@/lib/erp/remote-license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled jobs for serverless (Vercel Cron). Replaces node-cron.
 * Protected by CRON_SECRET (Vercel sends it as `Authorization: Bearer <secret>`).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = { recurringCreated: 0, sheetsSynced: false as boolean, staleReminded: 0, licenseOk: null as boolean | null };

  // On-prem deployments must phone home every 24 h to verify their license.
  if (isOnPremMode()) {
    try {
      const hb = await performHeartbeat();
      result.licenseOk = hb.ok;
    } catch (e) {
      console.error("[cron] license heartbeat failed", e);
      result.licenseOk = false;
    }
  }
  try {
    result.recurringCreated = await runDueRecurrences();
  } catch (e) {
    console.error("[cron] recurring failed", e);
  }
  try {
    result.staleReminded = await remindStaleProducts(3);
  } catch (e) {
    console.error("[cron] stale reminders failed", e);
  }
  // Google Sheets sync is disabled for now; safe no-op if no connections.
  try {
    await syncAllDue();
    result.sheetsSynced = true;
  } catch (e) {
    console.error("[cron] sheets sync failed", e);
  }

  return Response.json({ ok: true, ...result });
}
