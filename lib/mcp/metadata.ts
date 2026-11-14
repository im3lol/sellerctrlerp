import { mcpUrls, MCP_SCOPES } from "./policy";
import { oauthJson } from "./http";

export function authorizationMetadata() {
  const u = mcpUrls();
  return oauthJson({ issuer: u.issuer, authorization_endpoint: `${u.origin}/mcp/authorize`,
    token_endpoint: `${u.issuer}/token`, registration_endpoint: `${u.issuer}/register`,
    revocation_endpoint: `${u.issuer}/revoke`, response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"], scopes_supported: Object.keys(MCP_SCOPES),
  });
}
export function resourceMetadata() {
  const u = mcpUrls();
  return oauthJson({ resource: u.resource, authorization_servers: [u.issuer],
    bearer_methods_supported: ["header"], scopes_supported: Object.keys(MCP_SCOPES),
    resource_name: "SellerCtrl ERP — personal read-only access" });
}
