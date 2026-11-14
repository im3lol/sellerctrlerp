import { describe, it, expect, beforeEach, vi } from "vitest";
const mock = vi.hoisted(() => ({
  user: { id: "member", role: "employee" },
  member: { role: "sales", isActive: true, overrides: { grant: [] as string[], revoke: [] as string[] } },
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: async () => mock.user }));
vi.mock("@/lib/db-scope", () => ({ withOrgScope: (_: string, __: boolean, fn: () => unknown) => fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [mock.member] }) }) }) } }));
import { requireErpCapability } from "../auth-guard";
beforeEach(() => {
  mock.user = { id: "member", role: "employee" };
  mock.member = { role: "sales", isActive: true, overrides: { grant: [], revoke: [] } };
});
describe("effective member permissions on legacy capability guards", () => {
  it("honors an explicit revoke even when the base role permits it", async () => {
    mock.member.overrides.revoke = ["sales.confirm"];
    await expect(requireErpCapability("org", "sales.confirm")).rejects.toMatchObject({ status: 403 });
  });
  it("honors an explicit per-user grant outside the base role", async () => {
    mock.member.overrides.grant = ["accounting.view"];
    await expect(requireErpCapability("org", "accounting.view")).resolves.toMatchObject({ id: "member", organizationId: "org" });
  });
  it("rejects a disabled membership", async () => {
    mock.member.isActive = false;
    await expect(requireErpCapability("org", "sales.view")).rejects.toMatchObject({ status: 403 });
  });
});
