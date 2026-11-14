export type DriveOperation = "token" | "account" | "folder" | "upload";
const reasons = new Set(["invalid_client", "unauthorized_client", "invalid_grant", "invalid_scope", "redirect_uri_mismatch", "accessNotConfigured", "SERVICE_DISABLED", "serviceDisabled", "insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "storageQuotaExceeded", "rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"]);

/** Only allowlisted codes escape the provider response; never retain its raw body. */
export class DriveProviderError extends Error {
  constructor(public operation: DriveOperation, public status: number, public reason: string) { super(`Google Drive ${operation} failed`); }
}

export function safeGoogleReason(body: unknown): string {
  if (!body || typeof body !== "object") return "unknown";
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return reasons.has(error) ? error : "unknown";
  if (!error || typeof error !== "object") return "unknown";
  const fields = error as { errors?: Array<{ reason?: string }>; details?: Array<{ reason?: string }> };
  for (const item of [...(Array.isArray(fields.errors) ? fields.errors : []), ...(Array.isArray(fields.details) ? fields.details : [])]) if (item && typeof item.reason === "string" && reasons.has(item.reason)) return item.reason;
  return "unknown";
}

export function driveFailure(error: unknown, stage: string) {
  if (error instanceof DriveProviderError) {
    const { reason, status, operation } = error;
    const code = ["accessNotConfigured", "SERVICE_DISABLED", "serviceDisabled"].includes(reason) ? "drive-api"
      : ["invalid_client", "unauthorized_client", "redirect_uri_mismatch"].includes(reason) ? "client-config"
      : ["invalid_grant", "missing_refresh_token"].includes(reason) ? "reconnect"
      : ["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "invalid_scope", "consent_missing"].includes(reason) ? "permissions"
      : reason === "storageQuotaExceeded" ? "quota"
      : status === 429 || status >= 500 || ["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"].includes(reason) ? "temporary"
      : "connect";
    return { code, diagnostic: { stage: operation, status, reason } };
  }
  const name = error instanceof Error ? error.name : "Error";
  const databaseCode = stage === "persist" && error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : undefined;
  return { code: ["TimeoutError", "AbortError", "TypeError"].includes(name) ? "temporary" : "connect", diagnostic: { stage, reason: databaseCode || "internal" } };
}
