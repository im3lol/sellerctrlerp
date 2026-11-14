import "server-only";
import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, organizations } from "@/db/schema";
import { mcpClients, mcpGrants, mcpCodes, mcpRefreshTokens } from "@/db/mcp";
import { withPlatformScope } from "@/lib/db-scope";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { getEnabledModules } from "@/lib/erp/entitlements";
import type { SessionUser } from "@/lib/session";
import type { ErpPermission } from "@/lib/erp/permissions";
import { digest, mcpUrls, MCP_SCOPES, opaque, parseScopes, pkceMatches, validRedirect } from "./policy";
import { withMcpUserScope } from "./scope";

const accessKey = () => {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", process.env.AUTH_SECRET).update("sellerctrl:mcp:access:v1").digest();
};
type Grant = typeof mcpGrants.$inferSelect;
export type McpPrincipal = {
  grant: Grant; userId: string; orgId: string; role: string; scopes: Set<string>;
  permissions: Set<string>; canReadCosts: boolean;
};
export type AuthorizationRequest = { client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; scope: string; state: string; resource: string };

export async function validateAuthorization(input: AuthorizationRequest) {
  if (input.response_type !== "code" || input.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge) || input.state.length > 2048 ||
      input.resource !== mcpUrls().resource) throw new Error("invalid_request");
  const scopes = parseScopes(input.scope);
  const [client] = await withPlatformScope(() => db.select().from(mcpClients).where(eq(mcpClients.id, input.client_id)).limit(1));
  if (!client || !validRedirect(input.redirect_uri) || !client.redirectUris.includes(input.redirect_uri)) throw new Error("invalid_client");
  return { client, scopes };
}

async function userAccess(userId: string, orgId: string) {
  const [user] = await db.select({ id: users.id, role: users.role, active: users.isActive, version: users.sessionVersion })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.active) return null;
  const access = await getMemberAccess(orgId, { id: user.id, role: user.role } as SessionUser);
  if (!access.role) return null;
  const modules = access.role === "super_admin" ? null : await getEnabledModules(orgId);
  const enabled = (scope: string) => {
    const s = MCP_SCOPES[scope];
    return !!s && (!s.permission || access.permissions.has(s.permission)) && (!s.module || modules === null || modules.has(s.module));
  };
  return { user, access, enabled };
}

/** Called only after a logged-in user approves the displayed client/org/scopes. */
export async function approveAuthorization(userId: string, orgId: string, input: AuthorizationRequest) {
  const { scopes } = await validateAuthorization(input);
  return withMcpUserScope(orgId, userId, async () => {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const current = await userAccess(userId, orgId);
    if (!org || !current) throw new Error("access_denied");
    const allowedScopes = scopes.filter(scope => current.enabled(scope));
    if (!allowedScopes.length) throw new Error("access_denied");
    const [grant] = await db.insert(mcpGrants).values({ organizationId: orgId, userId, clientId: input.client_id,
      scopes: allowedScopes, sessionVersion: current.user.version, expiresAt: new Date(Date.now() + 30 * 86400_000) }).returning();
    const code = opaque();
    await db.insert(mcpCodes).values({ hash: digest(code), organizationId: orgId, grantId: grant.id,
      redirectUri: input.redirect_uri, challenge: input.code_challenge, expiresAt: new Date(Date.now() + 5 * 60_000) });
    const redirect = new URL(input.redirect_uri);
    redirect.searchParams.set("code", code);
    if (input.state) redirect.searchParams.set("state", input.state);
    return redirect.href;
  });
}

async function resolveGrant(grantId: string): Promise<McpPrincipal | null> {
  const [grant] = await db.select().from(mcpGrants).where(eq(mcpGrants.id, grantId)).limit(1);
  if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return null;
  const current = await userAccess(grant.userId, grant.organizationId);
  if (!current || grant.sessionVersion !== current.user.version) return null;
  const scopes = new Set(grant.scopes.filter(s => current.enabled(s)));
  const permissions = new Set<string>();
  for (const scope of scopes) { const p = MCP_SCOPES[scope]?.permission; if (p) permissions.add(p); }
  // Cost visibility is a read policy; never confer write capabilities on the MCP context.
  const canReadCosts = (scopes.has("purchases.read") || scopes.has("accounting.read")) &&
    ((scopes.has("purchases.read") && current.access.permissions.has("purchases.create")) ||
      (scopes.has("accounting.read") && current.access.permissions.has("accounting.view")));
  return { grant, userId: grant.userId, orgId: grant.organizationId, role: current.access.role!, scopes, permissions, canReadCosts };
}

async function issueTokens(grant: Grant) {
  const refresh = opaque();
  await db.insert(mcpRefreshTokens).values({ hash: digest(refresh), organizationId: grant.organizationId, grantId: grant.id, expiresAt: grant.expiresAt });
  const urls = mcpUrls();
  const access = await new SignJWT({ gid: grant.id, org: grant.organizationId, sv: grant.sessionVersion })
    .setProtectedHeader({ alg: "HS256" }).setSubject(grant.userId).setIssuer(urls.issuer).setAudience(urls.resource)
    .setJti(opaque()).setIssuedAt().setExpirationTime("10m").sign(accessKey());
  return { access_token: access, token_type: "Bearer", expires_in: 600, refresh_token: refresh, scope: grant.scopes.join(" ") };
}

export async function exchangeToken(input: Record<string, string>) {
  if (input.resource && input.resource !== mcpUrls().resource) return { error: "invalid_target" };
  if (input.client_secret || !input.client_id) return { error: "invalid_client" };
  return withPlatformScope(async () => {
    if (input.grant_type === "authorization_code") {
      const [code] = await db.select().from(mcpCodes).where(eq(mcpCodes.hash, digest(input.code ?? ""))).limit(1).for("update");
      if (!code || code.expiresAt.getTime() <= Date.now() || code.redirectUri !== input.redirect_uri || !pkceMatches(input.code_verifier ?? "", code.challenge)) return { error: "invalid_grant" };
      const principal = await resolveGrant(code.grantId);
      if (!principal || principal.grant.clientId !== input.client_id) return { error: "invalid_grant" };
      if (code.usedAt) {
        await db.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, code.grantId));
        return { error: "invalid_grant" };
      }
      await db.update(mcpCodes).set({ usedAt: new Date() }).where(eq(mcpCodes.hash, code.hash));
      return issueTokens(principal.grant);
    }
    if (input.grant_type === "refresh_token") {
      const [refresh] = await db.select().from(mcpRefreshTokens).where(eq(mcpRefreshTokens.hash, digest(input.refresh_token ?? ""))).limit(1).for("update");
      if (!refresh || refresh.expiresAt.getTime() <= Date.now()) return { error: "invalid_grant" };
      const principal = await resolveGrant(refresh.grantId);
      if (!principal || principal.grant.clientId !== input.client_id) return { error: "invalid_grant" };
      if (refresh.usedAt) {
        await db.update(mcpGrants).set({ revokedAt: new Date() }).where(eq(mcpGrants.id, refresh.grantId));
        return { error: "invalid_grant" };
      }
      if (input.scope) {
        let scopes: string[];
        try { scopes = parseScopes(input.scope); } catch { return { error: "invalid_scope" }; }
        if (scopes.some(s => !principal.grant.scopes.includes(s))) return { error: "invalid_scope" };
        await db.update(mcpGrants).set({ scopes }).where(eq(mcpGrants.id, principal.grant.id));
        principal.grant.scopes = scopes;
      }
      await db.update(mcpRefreshTokens).set({ usedAt: new Date() }).where(eq(mcpRefreshTokens.hash, refresh.hash));
      return issueTokens(principal.grant);
    }
    return { error: "unsupported_grant_type" };
  });
}

export async function authenticateMcp(token: string): Promise<McpPrincipal | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), { issuer: mcpUrls().issuer, audience: mcpUrls().resource,
      algorithms: ["HS256"], requiredClaims: ["sub", "iat", "exp", "jti"] });
    if (typeof payload.gid !== "string") return null;
    return withPlatformScope(async () => {
      const principal = await resolveGrant(payload.gid as string);
      if (!principal || payload.sub !== principal.userId || payload.org !== principal.orgId || payload.sv !== principal.grant.sessionVersion) return null;
      await db.update(mcpGrants).set({ lastUsedAt: new Date() }).where(and(eq(mcpGrants.id, principal.grant.id), isNull(mcpGrants.revokedAt)));
      return principal;
    });
  } catch { return null; }
}

export function scopePermission(scope: string): ErpPermission | undefined { return MCP_SCOPES[scope]?.permission; }
