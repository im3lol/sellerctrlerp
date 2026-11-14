import { describe, expect, it } from "vitest";
import { DriveProviderError, driveFailure, safeGoogleReason } from "./storage-cloud-errors";

describe("safe Google diagnostics", () => {
  it("identifies a disabled API from either Google error format", () => {
    for (const body of [{ error: { errors: [{ reason: "accessNotConfigured" }] } }, { error: { details: [{ reason: "SERVICE_DISABLED" }] } }]) {
      expect(driveFailure(new DriveProviderError("account", 403, safeGoogleReason(body)), "folder").code).toBe("drive-api");
    }
  });
  it.each([['invalid_client','client-config'],['invalid_grant','reconnect'],['insufficientPermissions','permissions'],['storageQuotaExceeded','quota']])("maps %s to an actionable category", (reason, code) => {
    expect(driveFailure(new DriveProviderError("token", 400, reason), "token").code).toBe(code);
  });
  it("does not log token strings, provider messages or arbitrary reasons", () => {
    const body = { error: { message: "client_secret=private", errors: [{ reason: "access_token=private" }] } };
    expect(safeGoogleReason(body)).toBe("unknown");
    const report = driveFailure(new Error("client_secret=private"), "persist");
    expect(JSON.stringify(report)).not.toContain("private");
    expect(report.diagnostic).toEqual({ stage: "persist", reason: "internal" });
  });
  it("distinguishes temporary provider and network failures", () => {
    expect(driveFailure(new DriveProviderError("folder", 503, "unknown"), "folder").code).toBe("temporary");
    expect(driveFailure(new DOMException("private", "TimeoutError"), "token").code).toBe("temporary");
  });
});
