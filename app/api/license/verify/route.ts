import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { installationLicenses } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * On-premises license verification endpoint — the owner's server signs every
 * response with its Ed25519 private key so the client can reject fake servers.
 * Only active when LICENSE_SIGN_PRIVATE_KEY is configured (owner's deployment).
 */
export async function POST(req: Request) {
  const privateKeyPem = process.env.LICENSE_SIGN_PRIVATE_KEY;
  if (!privateKeyPem) {
    return Response.json({ error: "License signing not configured on this server" }, { status: 503 });
  }

  let body: { licenseKey?: string; installId?: string; ts?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { licenseKey, installId, ts } = body;
  if (!licenseKey || !installId || !ts) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (Math.abs(Date.now() - ts) > 300_000) {
    return Response.json({ error: "Request timestamp too old" }, { status: 400 });
  }

  const now = new Date();
  const timestamp = Date.now();

  let valid = false;
  let modules: string[] = [];
  let expiresAt: string | null = null;
  let graceDays = 7;

  const [lic] = await db
    .select()
    .from(installationLicenses)
    .where(eq(installationLicenses.licenseKey, licenseKey))
    .limit(1);

  if (lic && lic.status === "ACTIVE") {
    valid = !lic.expiresAt || new Date(lic.expiresAt) > now;
    modules = lic.enabledModules;
    expiresAt = lic.expiresAt ? new Date(lic.expiresAt).toISOString() : null;
    graceDays = lic.gracePeriodDays;

    await db
      .update(installationLicenses)
      .set({ installId, lastHeartbeatAt: now, updatedAt: now })
      .where(eq(installationLicenses.id, lic.id));
  }

  // Sign the response with Ed25519 so the client can reject tampered/faked responses.
  const payload = `${valid}|${expiresAt ?? ""}|${modules.sort().join(",")}|${graceDays}|${timestamp}`;
  const privKey = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload), privKey).toString("base64");

  return Response.json({ valid, modules, expiresAt, graceDays, timestamp, sig });
}
