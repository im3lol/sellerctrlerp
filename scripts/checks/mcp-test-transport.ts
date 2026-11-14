import { mcpUrls } from "@/lib/mcp/policy";
import { request } from "node:http";

/** Optional actual-HTTP path to the disposable candidate container, never production. */
export async function forwardMcpTestRequest(req: Request): Promise<Response | undefined> {
  const origin = process.env.MCP_CHECK_HTTP_ORIGIN;
  if (!origin) return undefined;
  const target = new URL(origin);
  if (target.protocol !== "http:" || target.hostname !== "127.0.0.1" || target.port !== "3012") {
    throw new Error("MCP HTTP tests only target the disposable server on 127.0.0.1:3012");
  }
  const source = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set("host", new URL(mcpUrls().resource).host);
  const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.text();
  // Native fetch may rewrite Host to the local transport address. Keep the
  // canonical virtual host while connecting only to the guarded test port.
  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(`${target.origin}${source.pathname}${source.search}`, {
      method: req.method, headers: Object.fromEntries(headers), timeout: 30000,
    }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on("data", chunk => chunks.push(Buffer.from(chunk)));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        const status = incoming.statusCode ?? 500;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks).toString("utf8"), { status, headers: responseHeaders }));
      });
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("MCP test HTTP timeout")));
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
