import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mcpGrants, mcpRefreshTokens } from "@/db/mcp";
import { withPlatformScope } from "@/lib/db-scope";
import { authenticateMcp } from "@/lib/mcp/auth";
import { digest } from "@/lib/mcp/policy";
import { oauthJson, readTextLimited } from "@/lib/mcp/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!await rateLimit(`mcp-revoke:${clientIp(req.headers)}`, 60, 60_000)) return oauthJson({ error: "rate_limited" }, 429);
  try {
    if (!req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return oauthJson({ error: "invalid_request" }, 400);
    const params = new URLSearchParams(await readTextLimited(req));
    if (!params.get("client_id") || params.getAll("token").length !== 1 || params.getAll("client_id").length !== 1) return oauthJson({ error: "invalid_request" }, 400);
    const token = params.get("token")!;
    const principal = await authenticateMcp(token);
    await withPlatformScope(async () => {
      const [refresh] = await db.select({ grantId: mcpRefreshTokens.grantId }).from(mcpRefreshTokens).where(eq(mcpRefreshTokens.hash, digest(token))).limit(1);
      const grantId = principal?.grant.id ?? refresh?.grantId;
      if (grantId) await db.update(mcpGrants).set({ revokedAt: new Date() }).where(and(eq(mcpGrants.id, grantId), eq(mcpGrants.clientId, params.get("client_id")!)));
    });
    return oauthJson({});
  } catch { return oauthJson({ error: "invalid_request" }, 400); }
}
