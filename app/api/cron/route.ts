import { runDueRecurrences } from "@/lib/recurring";
import { syncAllDue } from "@/lib/sync";
import { remindStaleProducts } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled jobs for serverless (Vercel Cron). Replaces node-cron.
 * Protected by CRON_SECRET (Vercel sends it as `Authorization: Bearer <secret>`).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  }

  const result = { recurringCreated: 0, sheetsSynced: false as boolean, staleReminded: 0 };
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
