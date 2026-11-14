vi.mock("server-only", () => ({}));
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/erp/action-auth", () => ({ authorizeErp: async () => ({ userId: "u", orgId: "o" }) }));
vi.mock("@/lib/erp/storage-cloud", () => ({ cloudCallbackUrl: () => "https://storage.example.com/api/storage/google/callback", DRIVE_SCOPE: "scope", googleDriveConfig: async () => null }));
vi.mock("@/lib/erp/storage-cloud-state", () => ({ createCloudState: vi.fn() }));
import { GET } from "@/app/api/storage/google/start/route";
afterEach(() => vi.clearAllMocks());
it("does not loop when a TLS-terminating proxy forwards an internal HTTP request", async () => {
  vi.stubEnv("AUTH_SECRET", "test-only-private-cookie-secret");
  const response = await GET(new Request("http://storage.example.com/api/storage/google/start", { headers: { host: "storage.example.com" } }));
  expect(response.headers.get("location")).toBe("https://storage.example.com/storage/cloud");
});
it("moves OAuth initialization to the configured storage host", async () => {
  const response = await GET(new Request("https://app.example.com/api/storage/google/start"));
  expect(response.headers.get("location")).toBe("https://storage.example.com/api/storage/google/start");
});
