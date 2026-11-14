import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/lib/erp/action-auth", () => ({ authorizeErp: mock.authorize }));
import { authorizeExportDataset } from "../export-access";
const dataset = { title: "PO", module: "purchases.view" as const, purchaseCosts: true, headers: [], fetch: async () => [] };
const auth = { orgId: "a", userId: "b", role: "inventory" };
beforeEach(() => mock.authorize.mockReset());
describe("saved report export authorization", () => {
  it("rejects a warehouse member who can receive but cannot read costs", async () => {
    mock.authorize.mockImplementation(async (p: string) => p === "purchases.view" ? auth : { error: "forbidden" });
    expect(await authorizeExportDataset(dataset)).toHaveProperty("error");
  });
  it("allows an accountant while preserving the original company and identity", async () => {
    mock.authorize.mockImplementation(async (p: string) => p === "purchases.create" ? { error: "forbidden" } : auth);
    expect(await authorizeExportDataset(dataset)).toEqual(auth);
  });
  it("does not allow cost access to bypass a missing dataset permission", async () => {
    mock.authorize.mockResolvedValue({ error: "forbidden" });
    expect(await authorizeExportDataset(dataset)).toEqual({ error: "forbidden" });
    expect(mock.authorize).toHaveBeenCalledTimes(1);
  });
});
