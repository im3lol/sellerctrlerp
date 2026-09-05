import { getCurrentUser } from "@/lib/session";
import { qzSign } from "@/lib/erp/qz-sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// qz-tray signs short per-request challenge strings, never bulk data — reject anything
// bigger as not a legitimate request rather than feed it to the signer.
const MAX_LEN = 8192;

/** POST /api/erp/qz/sign — qz-tray's setSignaturePromise; body is the raw string to sign. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const data = await req.text();
  if (!data || data.length > MAX_LEN) return new Response("bad request", { status: 400 });
  return new Response(qzSign(data), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
