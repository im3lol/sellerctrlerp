import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { desktopLicenses, organizations } from "@/db/schema";
import { ALL_MODULES } from "@/lib/erp/module-list";

const SECRET = process.env.DESKTOP_LICENSE_SECRET ?? "SC_DL_DEFAULT_SECRET_CHANGE_IN_ENV";

function hashToken(raw: string): string {
  return createHmac("sha256", SECRET).update(raw.trim().toUpperCase()).digest("hex");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = String(body?.token ?? "").trim();
    if (!token) return Response.json({ valid: false, error: "token_missing" }, { status: 400 });

    const hash = hashToken(token);
    const [license] = await db
      .select({
        id: desktopLicenses.id,
        status: desktopLicenses.status,
        enabledModules: desktopLicenses.enabledModules,
        expiresAt: desktopLicenses.expiresAt,
        organizationId: desktopLicenses.organizationId,
        orgName: organizations.nameAr,
      })
      .from(desktopLicenses)
      .leftJoin(organizations, eq(organizations.id, desktopLicenses.organizationId))
      .where(eq(desktopLicenses.tokenHash, hash))
      .limit(1);

    if (!license) return Response.json({ valid: false, error: "invalid_token" }, { status: 401 });
    if (license.status !== "ACTIVE") return Response.json({ valid: false, error: "revoked" }, { status: 403 });

    const now = new Date();
    if (license.expiresAt && new Date(license.expiresAt) < now) {
      return Response.json({ valid: false, error: "expired" }, { status: 403 });
    }

    // Update last heartbeat
    await db.update(desktopLicenses).set({ lastHeartbeatAt: now }).where(eq(desktopLicenses.id, license.id));

    const modules = (license.enabledModules?.length ? license.enabledModules : ALL_MODULES).filter((m) =>
      ALL_MODULES.includes(m as never),
    );

    return Response.json({
      valid: true,
      modules,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      tenantName: license.orgName ?? null,
    });
  } catch (err) {
    console.error("[desktop-license] validate error:", err);
    return Response.json({ valid: false, error: "server_error" }, { status: 500 });
  }
}
