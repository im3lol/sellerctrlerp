vi.mock("@/lib/ui-notice", () => ({ noticeTarget: async (target: string) => target }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), limit: vi.fn(), backup: vi.fn(), switchOrg: vi.fn(), scope: vi.fn(), audit: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/erp/action-auth", () => ({ authorizeErp: mocks.authorize }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
vi.mock("@/lib/erp/backup", () => ({ backupOrgToStorage: mocks.backup }));
vi.mock("@/lib/erp/audit", () => ({ tryRecordAudit: mocks.audit }));
vi.mock("@/lib/erp/org", () => ({ getActiveOrg: async () => ({ org: { id: "own-org", nameAr: "Company" } }) }));
vi.mock("@/lib/db-scope", () => ({ withOrgScope: mocks.scope }));
vi.mock("@/app/actions/org", () => ({ setActiveOrgAction: mocks.switchOrg }));
import { createStorageBackupAction, openStorageOrgAction } from "@/app/actions/storage-portal";
import { attachmentPermissions } from "../attachment-policy";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ orgId: "own-org", userId: "user", role: "owner" });
  mocks.limit.mockResolvedValue(true);
  mocks.scope.mockImplementation(async (_id, _admin, fn) => fn());
  mocks.backup.mockResolvedValue({ totalRows: 4, tableCount: 2 });
});

describe("storage portal authorization", () => {
  it("does not create a backup without settings permission", async () => {
    mocks.authorize.mockResolvedValue({ error: "forbidden" });
    await expect(createStorageBackupAction()).rejects.toThrow("redirect:/storage?error=denied");
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it("limits repeated full-company backups before touching data", async () => {
    mocks.limit.mockResolvedValue(false);
    await expect(createStorageBackupAction()).rejects.toThrow("redirect:/storage?error=limit");
    expect(mocks.backup).not.toHaveBeenCalled();
  });
  it("backs up only the authorized company in a non-bypass tenant scope", async () => {
    await expect(createStorageBackupAction()).rejects.toThrow("redirect:/storage?created=1");
    expect(mocks.scope).toHaveBeenCalledWith("own-org", false, expect.any(Function));
    expect(mocks.backup).toHaveBeenCalledWith("own-org", "Company", "MANUAL", "user");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ orgId: "own-org", userId: "user" }));
  });
  it("rejects switching to an unauthorized company", async () => {
    mocks.switchOrg.mockResolvedValue({ ok: false });
    await expect(openStorageOrgAction("other-org")).rejects.toThrow("redirect:/storage?error=denied");
  });
  it.each([["sales_invoice", "sales.view"], ["PURCHASE_ORDER", "purchases.view"], ["GOODS_RECEIPT", "inventory.view"], ["unmapped", "accounting.view"]])("keeps file permissions aligned for %s", (entity, permission) => {
    expect(attachmentPermissions(entity).view).toBe(permission);
  });
});
