import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import type { SessionUser } from "@/lib/session";
import type { ErpPermission } from "@/lib/erp/permissions";

/**
 * Bearer-token auth for the mobile/native API (`/api/v1/**`). Mirrors the web's
 * cookie-based {@link authorizeErp}: same permission model, but the caller is a
 * per-user JWT (issued at login) + an `X-Org-Id` header instead of a session
 * cookie. The token is signed with AUTH_SECRET (shared with next-auth).
 */
const ISSUER = "sellerctrl-api";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

/** Issue a 30-day access token for a user id. */
export async function signApiToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export type ApiAuth = { userId: string; orgId: string; role: string; can: (p: ErpPermission) => boolean };
export type ApiAuthError = { error: string; status: number };
export const isApiError = (r: ApiAuth | ApiAuthError): r is ApiAuthError => "error" in r;

/**
 * Resolve the caller from the Bearer token + `X-Org-Id`, and enforce an ERP
 * permission in that org. Returns `{ userId, orgId, role, can }` or an error
 * with an HTTP status. system_admin gets all permissions (via getMemberAccess).
 */
export async function authorizeApi(req: Request, permission: ErpPermission): Promise<ApiAuth | ApiAuthError> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) return { error: "unauthorized", status: 401 };

  let userId: string;
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER });
    userId = String(payload.sub ?? "");
  } catch {
    return { error: "invalid_token", status: 401 };
  }
  if (!userId) return { error: "invalid_token", status: 401 };

  const [u] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.isActive) return { error: "unauthorized", status: 401 };

  const orgId = req.headers.get("x-org-id")?.trim() ?? "";
  if (!orgId) return { error: "org_required", status: 400 };

  const access = await getMemberAccess(orgId, { id: u.id, role: u.role } as SessionUser);
  if (!access.role) return { error: "forbidden_org", status: 403 };
  if (!access.permissions.has(permission)) return { error: "forbidden", status: 403 };

  return { userId: u.id, orgId, role: access.role, can: (p) => access.permissions.has(p) };
}
