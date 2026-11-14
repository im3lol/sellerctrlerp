vi.mock("server-only", () => ({}));
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
import proxy from "../../../proxy";

const continuation = "/mcp/authorize?client_id=example&state=kept&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fcallback";
function request(path: string, role?: string, origin = "https://app.sellerctrl.com") {
  const handler = proxy as unknown as (req: { nextUrl: URL; auth: unknown; headers: Headers; method: string }) => Response | undefined;
  const url = new URL(path, origin);
  Object.assign(url, { clone: () => new URL(url) });
  return handler({ nextUrl: url, auth: role ? { user: { role } } : null, headers: new Headers({ host: url.host }), method: "GET" });
}
function loginRequest(path: string, role?: string, origin = "https://sellerctrl.com") {
  return request(path, role, origin);
}
describe("login proxy continuation", () => {
  it("cleans legacy message URLs without dropping business filters", () => {
    vi.stubEnv("AUTH_SECRET", "unit-test-only-private-notice-key");
    const response = request("/admin/integrations?cloudSaved=1&tab=cloud", "system_admin");
    expect(response?.headers.get("location")).toBe("https://app.sellerctrl.com/admin/integrations?tab=cloud");
    expect(response?.headers.get("set-cookie")).toContain("HttpOnly");
    expect(request("/inventory/items?status=active&page=2", "employee")).toBeUndefined();
  });
  it.each(["https://app.sellerctrl.com", "https://storage.sellerctrl.com", "https://www.sellerctrl.com"])("consolidates login on the primary domain from %s", origin => {
    const path = "/login?callbackUrl=%2Fdashboard&expired=1";
    expect(request(path, undefined, origin)?.headers.get("location")).toBe("https://sellerctrl.com" + path);
    expect(request("/login/admin", undefined, origin)?.headers.get("location")).toBe("https://sellerctrl.com/login/admin");
  });
  it("sends an anonymous dashboard visitor directly to primary-domain login", () => {
    expect(request("/dashboard")?.headers.get("location")).toBe("https://sellerctrl.com/login?callbackUrl=%2Fdashboard");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("canonicalizes portal entry to the storage host while retaining filters", () => {
    vi.stubEnv("STORAGE_PORTAL_URL", "https://storage.sellerctrl.com");
    expect(request("/storage?view=files")?.headers.get("location")).toBe("https://storage.sellerctrl.com/?view=files");
    expect(request("/storage/admin", "system_admin")?.headers.get("location")).toBe("https://storage.sellerctrl.com/storage/admin");
  });
  it("requires authentication on the storage portal", () => {
    vi.stubEnv("STORAGE_PORTAL_URL", "https://storage.sellerctrl.com");
    const response = request("/storage", undefined, "https://storage.sellerctrl.com");
    expect(new URL(response!.headers.get("location")!).pathname).toBe("/login");
  });
  it.each(["employee", "system_admin"])("resumes an already logged-in %s's OAuth request instead of opening Apps", role => {
    expect(loginRequest(`/login?callbackUrl=${encodeURIComponent(continuation)}`, role)?.headers.get("location")).toBe(`https://app.sellerctrl.com${continuation}`);
  });
  it("resumes OAuth through admin login", () => {
    expect(loginRequest(`/login/admin?callbackUrl=${encodeURIComponent(continuation)}`, "system_admin")?.headers.get("location")).toBe(`https://app.sellerctrl.com${continuation}`);
  });
  it("preserves full OAuth query when a session is missing", () => {
    const target = new URL(request(continuation)!.headers.get("location")!);
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("callbackUrl")).toBe(continuation);
  });
  it("blocks external continuation and preserves normal defaults", () => {
    expect(loginRequest("/login?callbackUrl=https://evil.example", "employee")?.headers.get("location")).toBe("https://app.sellerctrl.com/dashboard");
    expect(loginRequest("/login/admin", "system_admin")?.headers.get("location")).toBe("https://app.sellerctrl.com/admin");
    expect(loginRequest("/login/admin", "employee")).toBeUndefined();
  });
  it("keeps the main domain landing public even for a signed-in customer", () => {
    expect(request("/", "employee", "https://sellerctrl.com")).toBeUndefined();
    expect(loginRequest("/login", undefined, "https://sellerctrl.com")).toBeUndefined();
  });
  it("sends the application root to the dashboard", () => {
    expect(request("/")?.headers.get("location")).toBe("https://app.sellerctrl.com/dashboard");
  });
  it("continues a main-domain login onto the app domain", () => {
    expect(loginRequest("/login", "employee", "https://sellerctrl.com")?.headers.get("location")).toBe("https://app.sellerctrl.com/dashboard");
    expect(loginRequest("/login/admin", "system_admin", "https://sellerctrl.com")?.headers.get("location")).toBe("https://app.sellerctrl.com/admin");
  });
  it("keeps business screens on the app domain and public image assets available", () => {
    expect(request("/inventory/items?search=part", undefined, "https://sellerctrl.com")?.headers.get("location")).toBe("https://app.sellerctrl.com/inventory/items?search=part");
    expect(request("/icons/icon-192.png")).toBeUndefined();
  });
  it("still denies the administration panel to a normal customer", () => {
    expect(request("/admin", "employee")?.headers.get("location")).toBe("https://sellerctrl.com/login/admin");
    expect(request("/admin", "system_admin")).toBeUndefined();
  });
});

