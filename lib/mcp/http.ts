import { mcpUrls } from "./policy";

export async function readTextLimited(req: Request, limit = 8192): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error("request_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export function oauthJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
export function mcpUnauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: {
    "Cache-Control": "no-store",
    "WWW-Authenticate": `Bearer resource_metadata="${mcpUrls().origin}/.well-known/oauth-protected-resource/mcp"`,
  } });
}
export function validMcpOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === mcpUrls().origin;
}
