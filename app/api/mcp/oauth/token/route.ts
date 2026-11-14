import { exchangeToken } from "@/lib/mcp/auth";
import { oauthJson, readTextLimited } from "@/lib/mcp/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!await rateLimit(`mcp-token:${clientIp(req.headers)}`, 120, 60_000)) return oauthJson({ error: "rate_limited" }, 429);
  try {
    if (!req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return oauthJson({ error: "invalid_request" }, 400);
    const params = new URLSearchParams(await readTextLimited(req));
    // Reject duplicate security parameters instead of allowing parser disagreement.
    if ([...new Set(params.keys())].some(k => params.getAll(k).length !== 1)) return oauthJson({ error: "invalid_request" }, 400);
    const result = await exchangeToken(Object.fromEntries(params));
    return oauthJson(result, "error" in result ? 400 : 200);
  } catch { return oauthJson({ error: "invalid_request" }, 400); }
}
