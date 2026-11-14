import { z } from "zod";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { mcpClients } from "@/db/mcp";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { oauthJson, readTextLimited } from "@/lib/mcp/http";
import { validRedirect } from "@/lib/mcp/policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const registration = z.object({ client_name: z.string().trim().min(1).max(80).default("MCP client"),
  redirect_uris: z.array(z.string().max(2048).refine(validRedirect)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});
export async function POST(req: Request) {
  if (!await rateLimit(`mcp-register:${clientIp(req.headers)}`, 20, 3600_000)) return oauthJson({ error: "rate_limited" }, 429);
  try {
    if (!req.headers.get("content-type")?.includes("application/json")) return oauthJson({ error: "invalid_client_metadata" }, 400);
    const parsed = registration.safeParse(JSON.parse(await readTextLimited(req)));
    if (!parsed.success) return oauthJson({ error: "invalid_client_metadata" }, 400);
    const [client] = await withPlatformScope(() => db.insert(mcpClients).values({ name: parsed.data.client_name,
      redirectUris: [...new Set(parsed.data.redirect_uris)] }).returning());
    return oauthJson({ client_id: client.id, client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
  } catch { return oauthJson({ error: "invalid_client_metadata" }, 400); }
}
