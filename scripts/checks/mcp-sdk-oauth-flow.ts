import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { POST as mcpPost } from "@/app/mcp/route";
import { POST as registerPost } from "@/app/api/mcp/oauth/register/route";
import { POST as tokenPost } from "@/app/api/mcp/oauth/token/route";
import { authorizationMetadata, resourceMetadata } from "@/lib/mcp/metadata";
import { approveAuthorization, authenticateMcp, type AuthorizationRequest } from "@/lib/mcp/auth";
import { POST as revokePost } from "@/app/api/mcp/oauth/revoke/route";
import { mcpUrls } from "@/lib/mcp/policy";
import { forwardMcpTestRequest } from "./mcp-test-transport";

/** Full SDK discovery/DCR/PKCE/token/refresh flow; browser consent is simulated
 * with an already-authorized fixture user in the disposable test database. */
export async function verifySdkOAuthFlow(userId: string, orgId: string, check: (ok: boolean, name: string) => void) {
  const saved: { info?: OAuthClientInformationMixed; tokens?: OAuthTokens; verifier?: string; url?: URL; tokenRequests: number } = { tokenRequests: 0 };
  const u = mcpUrls();
  const provider: OAuthClientProvider = {
    redirectUrl: "https://client.example/sdk-callback",
    clientMetadata: { client_name: "Official SDK OAuth test", redirect_uris: ["https://client.example/sdk-callback"],
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    clientInformation: () => saved.info, saveClientInformation: info => { saved.info = info; },
    tokens: () => saved.tokens, saveTokens: tokens => { saved.tokens = tokens; },
    saveCodeVerifier: verifier => { saved.verifier = verifier; },
    codeVerifier: () => { if (!saved.verifier) throw new Error("Missing verifier"); return saved.verifier; },
    redirectToAuthorization: url => { saved.url = url; },
  };
  const router: typeof fetch = async (input, init) => {
    const req = new Request(input, init); const target = new URL(req.url);
    if (target.origin !== u.origin) throw new Error("External network is not permitted in this test");
    if (target.pathname.endsWith("/token")) saved.tokenRequests++;
    const forwarded = await forwardMcpTestRequest(req);
    if (forwarded) return forwarded;
    if (["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"].includes(target.pathname)) return resourceMetadata();
    if (["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/api/mcp/oauth"].includes(target.pathname)) return authorizationMetadata();
    if (req.url === `${u.issuer}/register`) return registerPost(req);
    if (req.url === `${u.issuer}/token`) return tokenPost(req);
    if (target.pathname === "/mcp") return req.method === "POST" ? mcpPost(req) : new Response(null, { status: 405 });
    return new Response(null, { status: 404 });
  };
  const transport = new StreamableHTTPClientTransport(new URL(u.resource), { authProvider: provider, fetch: router });
  const first = new Client({ name: "OAuth discovery test", version: "1.0.0" });
  try { await first.connect(transport); } catch { /* Expected redirect for consent. */ }
  if (!saved.url || !saved.info) throw new Error("SDK did not reach the OAuth consent step");
  check(saved.url.pathname === "/mcp/authorize" && saved.url.searchParams.get("code_challenge_method") === "S256", "SDK discovers metadata, registers and starts PKCE consent");
  const params = Object.fromEntries(saved.url.searchParams);
  const redirect = new URL(await approveAuthorization(userId, orgId, { ...params, state: params.state ?? "", scope: params.scope ?? "erp.identity" } as AuthorizationRequest));
  await transport.finishAuth(redirect.searchParams.get("code")!);
  await first.close();
  check(!!saved.tokens?.access_token && !!saved.tokens.refresh_token, "SDK exchanges authorization code through the real token route");
  const connect = async () => {
    const client = new Client({ name: "OAuth connected test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(u.resource), { authProvider: provider, fetch: router }));
    try {
      const tools = (await client.listTools()).tools.map(t => t.name);
      check(tools.includes("search_items") && !tools.includes("get_financial_report"), "OAuth SDK session receives only currently permitted scopes");
    } finally { await client.close(); }
  };
  await connect();
  const oldRefresh = saved.tokens!.refresh_token;
  saved.tokens = { ...saved.tokens!, access_token: "expired-access-token" };
  await connect();
  check(saved.tokenRequests >= 2 && saved.tokens!.refresh_token !== oldRefresh, "SDK automatically refreshes and rotates an invalid access token");
  const revoked = await revokePost(new Request(`${u.issuer}/revoke`, { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: saved.info!.client_id, token: saved.tokens!.refresh_token! }),
  }));
  check(revoked.status === 200 && await authenticateMcp(saved.tokens!.access_token) === null, "OAuth revocation endpoint immediately blocks the connected SDK grant");
}
