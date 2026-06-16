import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { workspaceMembers } from "@/db/schema";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream (replaces Supabase Realtime).
 * Each client receives only events on channels it is allowed to see:
 *   - user:<own id>
 *   - workspace:<id> for every workspace it belongs to
 *   - global
 */
export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));

  const allowed = new Set<string>([
    `user:${userId}`,
    "global",
    ...memberships.map((m) => `workspace:${m.workspaceId}`),
  ]);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* stream closed */
        }
      };

      send(`retry: 3000\n\n`);
      send(`event: ready\ndata: {}\n\n`);

      const onEvent = (event: RealtimeEvent) => {
        if (!allowed.has(event.channel)) return;
        send(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      unsubscribe = await subscribe(onEvent);

      // Keep the connection alive through proxies.
      heartbeat = setInterval(() => send(`: ping\n\n`), 25000);

      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
