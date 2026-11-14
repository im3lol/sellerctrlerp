import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { SignJWT } from "jose";
const mock = vi.hoisted(() => ({
  user: { id: "user-a", role: "employee", isActive: true, sessionVersion: 3 },
  access: vi.fn(), module: vi.fn(),
  income: vi.fn(),
  modules: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [mock.user] }) }) }) } }));
vi.mock("@/lib/erp/auth-guard", () => ({ getMemberAccess: mock.access }));
vi.mock("@/lib/erp/entitlements", () => ({ moduleOfPermission: (p: string) => p.split(".")[0], orgHasModule: mock.module, getEnabledModules: mock.modules }));
vi.mock("@/lib/erp/mobile-reports", () => ({ incomeStatement: mock.income, balanceSheet: vi.fn(), cashFlowStatement: vi.fn() }));
import { authorizeApi, authorizeApiMember, signApiToken } from "../api-auth";
import { GET as financialReport } from "@/app/api/v1/financials/[key]/route";

const secret = "test-only-secret-for-auth-unit-tests";
const request = (token: string, org = "org-a") => new Request("https://erp.test/api/v1/inventory/items", {
  headers: { authorization: `Bearer ${token}`, "x-org-id": org },
});
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", secret);
  mock.user = { id: "user-a", role: "employee", isActive: true, sessionVersion: 3 };
  mock.access.mockReset().mockResolvedValue({ role: "inventory", permissions: new Set(["inventory.view"]) });
  mock.module.mockReset().mockResolvedValue(true);
  mock.income.mockReset().mockResolvedValue({ net: 100 });
  mock.modules.mockReset().mockResolvedValue(new Set(["inventory", "accounting", "sales", "purchases", "reports", "marketplace"]));
});
afterEach(() => vi.unstubAllEnvs());
describe("per-user API authorization", () => {
  it("binds a signed token to the user and authorized company", async () => {
    const result = await authorizeApi(request(await signApiToken("user-a", 3)), "inventory.view");
    expect(result).toMatchObject({ userId: "user-a", orgId: "org-a" });
    expect(mock.access).toHaveBeenCalledWith("org-a", { id: "user-a", role: "employee" });
  });
  it("revokes tokens immediately after a session version change, including SSE", async () => {
    const token = await signApiToken("user-a", 3);
    mock.user.sessionVersion = 4;
    expect(await authorizeApi(request(token), "inventory.view")).toMatchObject({ status: 401 });
    expect(await authorizeApiMember(request(token))).toMatchObject({ status: 401 });
    expect(mock.access).not.toHaveBeenCalled();
  });
  it("rejects legacy unversioned tokens after a reset", async () => {
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("user-a").setIssuer("sellerctrl-api").setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    expect(await authorizeApi(request(token), "inventory.view")).toMatchObject({ status: 401 });
  });
  it("rejects an inactive user", async () => {
    mock.user.isActive = false;
    expect(await authorizeApi(request(await signApiToken("user-a", 3)), "inventory.view")).toMatchObject({ status: 401 });
  });
  it("rejects another company and a revoked permission", async () => {
    const token = await signApiToken("user-a", 3);
    mock.access.mockResolvedValueOnce({ role: null, permissions: new Set() });
    expect(await authorizeApi(request(token, "org-b"), "inventory.view")).toMatchObject({ error: "forbidden_org", status: 403 });
    mock.access.mockResolvedValueOnce({ role: "inventory", permissions: new Set() });
    expect(await authorizeApi(request(token), "inventory.view")).toMatchObject({ error: "forbidden", status: 403 });
  });
  it("blocks unavailable paid modules and supports an explicit module override", async () => {
    mock.module.mockResolvedValue(false);
    expect(await authorizeApi(request(await signApiToken("user-a", 3)), "inventory.view", "marketplace")).toMatchObject({ error: "module_unavailable" });
    expect(mock.module).toHaveBeenCalledWith("org-a", "marketplace");
  });
  it("fails closed with a missing signing secret", async () => {
    const token = await signApiToken("user-a", 3);
    vi.stubEnv("AUTH_SECRET", "");
    expect(await authorizeApi(request(token), "inventory.view")).toMatchObject({ status: 401 });
  });
  it("does not load financial data for a reports-only user", async () => {
    mock.access.mockResolvedValue({ role: "sales", permissions: new Set(["reports.view", "sales.view"]) });
    const response = await financialReport(request(await signApiToken("user-a", 3)), { params: Promise.resolve({ key: "income" }) });
    expect(response.status).toBe(403);
    expect(mock.income).not.toHaveBeenCalled();
  });
  it("allows a permitted accountant to load the same report", async () => {
    mock.access.mockResolvedValue({ role: "accountant", permissions: new Set(["accounting.view"]) });
    const response = await financialReport(request(await signApiToken("user-a", 3)), { params: Promise.resolve({ key: "income" }) });
    expect(response.status).toBe(200);
    expect(mock.income).toHaveBeenCalledWith("org-a", undefined, undefined);
  });
  it("does not expose financial fields through inventory when accounting is outside the plan", async () => {
    mock.modules.mockResolvedValue(new Set(["inventory"]));
    mock.access.mockResolvedValue({ role: "inventory", permissions: new Set(["inventory.view", "accounting.view"]) });
    const result = await authorizeApi(request(await signApiToken("user-a", 3)), "inventory.view");
    expect("can" in result && result.can("accounting.view")).toBe(false);
  });
});
