import { describe, it, expect } from "vitest";
import { getErpContext, runWithErpContext } from "../erp-context";
const ctx = { userId: "a", orgId: "company", role: "sales", permissions: new Set(["sales.view"]) };
describe("ERP user context", () => {
  it("isolates users in the same company across concurrent requests", async () => {
    const results = await Promise.all(["a", "b"].map(userId => runWithErpContext({ ...ctx, userId }, async () => {
      await new Promise(resolve => setTimeout(resolve, userId === "a" ? 3 : 1));
      return getErpContext()?.userId;
    })));
    expect(results).toEqual(["a", "b"]);
    expect(getErpContext()).toBeUndefined();
  });
  it("blocks identity, company, role, system and permission escalation", async () => {
    await runWithErpContext(ctx, async () => {
      for (const override of [{ userId: "b" }, { orgId: "other" }, { role: "admin" }, { system: true }, { permissions: new Set(["accounting.post"]) }]) {
        expect(() => runWithErpContext({ ...ctx, ...override }, async () => undefined)).toThrow("Cannot change identity");
      }
    });
  });
  it("allows narrowing permissions and restores the parent", async () => {
    await runWithErpContext(ctx, async () => {
      await runWithErpContext({ ...ctx, permissions: new Set() }, async () => {
        expect(getErpContext()?.permissions.size).toBe(0);
      });
      expect(getErpContext()?.permissions.has("sales.view")).toBe(true);
    });
  });
});
