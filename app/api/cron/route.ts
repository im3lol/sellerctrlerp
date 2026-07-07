import { isOnPremMode, performHeartbeat } from "@/lib/erp/remote-license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled jobs (Vercel Cron). Protected by CRON_SECRET (sent as
 * `Authorization: Bearer <secret>`). ERP-only: on-prem license heartbeat.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = { licenseOk: null as boolean | null };

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

  return Response.json({ ok: true, ...result });
}
