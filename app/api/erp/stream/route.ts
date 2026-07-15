import { getActiveOrg } from "@/lib/erp/org";
import { subscribeErp } from "@/lib/erp/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/erp/stream — cookie-authed SSE change feed for the web app shell.
 * A client EventSource holds this open; any ERP mutation (incl. ones made from
 * the mobile app) pushes a `data:` line so the page soft-refreshes live.
 */
export async function GET(req: Request) {
  const { user, org } = await getActiveOrg();
  if (!user || !org) return new Response("unauthorized", { status: 401 });
  const orgId = org.id;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ action: "HELLO", entity: "", at: Date.now() });
      const unsub = subscribeErp(orgId, send);
      const ping = setInterval(() => {
        try { controller.enqueue(enc.encode(`: ping\n\n`)); } catch { /* closed */ }
      }, 25000);
      const close = () => { clearInterval(ping); unsub(); try { controller.close(); } catch { /* already closed */ } };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
