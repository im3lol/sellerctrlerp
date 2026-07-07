export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled cron endpoint (Vercel Cron), protected by CRON_SECRET. No scheduled
 * jobs are needed by the ERP web app at the moment — kept as a no-op so the cron
 * schedule in vercel.json has a valid target.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ ok: true });
}
