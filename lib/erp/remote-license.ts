import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { licenseHeartbeat } from "@/db/schema";

// Ed25519 public key baked into the build — matches LICENSE_SIGN_PRIVATE_KEY on the owner's server.
// Changing this requires rebuilding the Docker image, which protects against a fake license server.
// To rotate: run scripts/generate-license-keypair.mjs and update both sides.
const LICENSE_VERIFY_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAUZFmVyToE6f4FqfWWcrpfr3Fp6t5NdXlac6R6GDx5gs=
-----END PUBLIC KEY-----`;

export type HeartbeatStatus = "VALID" | "GRACE" | "LOCKED" | "UNCHECKED" | "DISABLED";

/** True when this deployment is an on-prem install that must phone home. */
export function isOnPremMode(): boolean {
  return !!process.env.INSTALL_LICENSE_KEY;
}

/** Current license state for this on-prem installation. Returns DISABLED for normal SaaS deployments. */
export async function getLicenseStatus(): Promise<{
  status: HeartbeatStatus;
  daysLeft?: number;
  modules: string[];
}> {
  if (!isOnPremMode()) return { status: "DISABLED", modules: [] };

  const [row] = await db.select().from(licenseHeartbeat).limit(1);
  if (!row) return { status: "UNCHECKED", modules: [] };

  const now = new Date();

  if (row.validUntil && new Date(row.validUntil) > now) {
    return { status: "VALID", modules: row.enabledModules };
  }

  if (row.gracePeriodEndsAt && new Date(row.gracePeriodEndsAt) > now) {
    const daysLeft = Math.ceil(
      (new Date(row.gracePeriodEndsAt).getTime() - now.getTime()) / 86_400_000,
    );
    return { status: "GRACE", daysLeft, modules: row.enabledModules };
  }

  return { status: "LOCKED", modules: [] };
}

/** Call the owner's license server, verify the Ed25519 response, update local cache. */
export async function performHeartbeat(): Promise<{ ok: boolean; error?: string }> {
  const licenseKey = process.env.INSTALL_LICENSE_KEY;
  const serverUrl = process.env.LICENSE_SERVER_URL;
  if (!licenseKey || !serverUrl) return { ok: false, error: "On-prem env vars not configured" };

  const [existing] = await db.select().from(licenseHeartbeat).limit(1);
  const installId = existing?.installId ?? crypto.randomUUID();
  const now = new Date();

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/license/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey, installId, ts: Date.now() }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await _cacheFailure(installId, existing, now);
    return { ok: false, error: "Network unreachable" };
  }

  if (!res.ok) {
    await _cacheFailure(installId, existing, now);
    return { ok: false, error: `License server returned ${res.status}` };
  }

  const data = (await res.json()) as {
    valid: boolean;
    modules: string[];
    expiresAt: string | null;
    graceDays: number;
    timestamp: number;
    sig: string;
  };

  // Verify Ed25519 signature — prevents fake license server responses.
  const payload = `${data.valid}|${data.expiresAt ?? ""}|${(data.modules ?? []).sort().join(",")}|${data.graceDays}|${data.timestamp}`;
  const pubKey = crypto.createPublicKey(LICENSE_VERIFY_PUBKEY);
  const valid = crypto.verify(null, Buffer.from(payload), pubKey, Buffer.from(data.sig, "base64"));
  if (!valid) return { ok: false, error: "Response signature invalid — possible spoofing" };

  if (Math.abs(Date.now() - data.timestamp) > 300_000) {
    return { ok: false, error: "Response timestamp too old (replay attack?)" };
  }

  const validUntil = data.expiresAt ? new Date(data.expiresAt) : null;

  if (data.valid) {
    await db
      .insert(licenseHeartbeat)
      .values({
        singleton: "1",
        installId,
        lastCheckedAt: now,
        validUntil,
        enabledModules: data.modules ?? [],
        status: "VALID",
        gracePeriodEndsAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: licenseHeartbeat.singleton,
        set: {
          installId,
          lastCheckedAt: now,
          validUntil,
          enabledModules: data.modules ?? [],
          status: "VALID",
          gracePeriodEndsAt: null,
          updatedAt: now,
        },
      });
  } else {
    const gracePeriodEndsAt = new Date(now.getTime() + data.graceDays * 86_400_000);
    await db
      .insert(licenseHeartbeat)
      .values({
        singleton: "1",
        installId,
        lastCheckedAt: now,
        validUntil: null,
        enabledModules: existing?.enabledModules ?? [],
        status: "GRACE",
        gracePeriodEndsAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: licenseHeartbeat.singleton,
        set: {
          installId,
          lastCheckedAt: now,
          validUntil: null,
          status: "GRACE",
          gracePeriodEndsAt,
          updatedAt: now,
        },
      });
  }

  return { ok: data.valid };
}

async function _cacheFailure(
  installId: string,
  existing: typeof licenseHeartbeat.$inferSelect | undefined,
  now: Date,
) {
  // On network failure, transition VALID→GRACE (start grace clock), or keep existing GRACE/LOCKED.
  const wasValid = !existing || existing.status === "VALID" || existing.status === "UNCHECKED";
  const gracePeriodEndsAt =
    existing?.gracePeriodEndsAt ?? new Date(now.getTime() + 7 * 86_400_000);
  const status = wasValid ? "GRACE" : (existing?.status ?? "GRACE");

  await db
    .insert(licenseHeartbeat)
    .values({
      singleton: "1",
      installId,
      lastCheckedAt: now,
      validUntil: existing?.validUntil ?? null,
      enabledModules: existing?.enabledModules ?? [],
      status,
      gracePeriodEndsAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: licenseHeartbeat.singleton,
      set: { lastCheckedAt: now, status, gracePeriodEndsAt, updatedAt: now },
    });
}
