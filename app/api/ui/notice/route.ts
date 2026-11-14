import { consumeNotice } from "@/lib/ui-notice";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try { sameOrigin = !!origin && new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); } catch { /* Reject malformed/null origins. */ }
  if (!sameOrigin) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 2048) return new Response(null, { status: 413 });
  try {
    const input = await request.json();
    if (typeof input.path !== "string" || typeof input.id !== "string" || input.path.length > 256 || input.id.length > 64) return new Response(null, { status: 400 });
    await consumeNotice(input.path, input.id);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 400 }); }
}
