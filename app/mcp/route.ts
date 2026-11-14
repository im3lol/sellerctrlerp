import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcp } from "@/lib/mcp/auth";
import { createErpMcpServer } from "@/lib/mcp/server";
import { mcpUnauthorized, validMcpOrigin } from "@/lib/mcp/http";
import { mcpUrls } from "@/lib/mcp/policy";
import { rateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.MCP_ENABLED === "0") return Response.json({ error: "mcp_disabled" }, { status: 503 });
  const hosts = new Set([new URL(mcpUrls().resource).host, "127.0.0.1:3001", "localhost:3001", "127.0.0.1:3000", "localhost:3000"]);
  if (!hosts.has(req.headers.get("host") ?? new URL(req.url).host) || !validMcpOrigin(req)) return Response.json({ error: "invalid_origin" }, { status: 403 });
  const token = /^Bearer\s+([^\s]+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const principal = token ? await authenticateMcp(token) : null;
  if (!principal) return mcpUnauthorized();
  if (!await rateLimit(`mcp-http:${principal.userId}:${principal.orgId}`, 120, 60_000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const server = createErpMcpServer(principal, token!);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 65536 });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally { await server.close(); }
}
// This deployment is stateless request/response; no unscoped SSE or session handles.
export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
export function DELETE() { return new Response(null, { status: 405, headers: { Allow: "POST" } }); }
