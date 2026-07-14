import { verifyCredentials } from "@/lib/auth/verify-credentials";
import { signApiToken } from "@/lib/erp/api-auth";
import { getUserOrganizations } from "@/lib/erp/org";
import type { SessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login — mobile/native login.
 * Body: { username|email, password, token? (TOTP) }.
 * Returns { token (Bearer, 30d), user, orgs }. The client sends the token as
 * `Authorization: Bearer <token>` + `X-Org-Id: <org.id>` on every request.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const identifier = String(body.username ?? body.email ?? "");
  const password = String(body.password ?? "");
  const otp = body.token != null ? String(body.token) : undefined;

  const user = await verifyCredentials(identifier, password, otp);
  if (!user) return Response.json({ error: "invalid_credentials" }, { status: 401 });

  const token = await signApiToken(user.id);
  const orgs = await getUserOrganizations({ id: user.id, role: user.role } as SessionUser);

  return Response.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    orgs: orgs.map((o) => ({ id: o.id, name: o.nameAr })),
  });
}
