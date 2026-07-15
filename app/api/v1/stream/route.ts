import { authorizeApiMember } from "@/lib/erp/api-auth";
import { subscribeErp } from "@/lib/erp/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/stream — Server-Sent Events change feed for the caller's org.
 * The mobile app holds this open; every ERP mutation pushes a `data:` line so
 * the app refetches live. Auth via Bearer header or ?token=&org= query.
 */
export async function GET(req: Request) {
  const auth = await authorizeApiMember(req);
  if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* closed */ }
      };
      send({ action: "HELLO", entity: "", at: Date.now() });
      const unsub = subscribeErp(auth.orgId, send);
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
