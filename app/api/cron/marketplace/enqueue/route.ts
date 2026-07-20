import { enqueueDueSyncs } from "@/lib/queue/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Enqueue-only scheduler endpoint. The worker already runs enqueueDueSyncs on an
 * internal timer (near-real-time), so this is just an optional external trigger
 * (e.g. a VPS crontab, or manual). It ONLY creates BullMQ jobs — returns in ms.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await enqueueDueSyncs();
  return Response.json({ ok: true, ...r });
}
