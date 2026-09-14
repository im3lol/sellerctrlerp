import { describe, it, expect } from "vitest";
import { launcherTiles } from "@/lib/launcher";
import { allErpPermissions } from "@/lib/erp/permissions";

const everything = new Set<string>(allErpPermissions);

describe("launcherTiles", () => {
  it("puts the dashboard and approvals up front, and the modules after", () => {
    const { featured, modules } = launcherTiles({ permissions: everything });
    expect(featured.map((f) => f.href)).toEqual(["/dashboard", "/approvals"]);
    expect(modules.some((m) => m.label === "المحاسبة")).toBe(true);
  });

  it("quick links span a module's groups instead of listing its first one", () => {
    const acc = launcherTiles({ permissions: everything }).modules.find((m) => m.label === "المحاسبة")!;
    expect(acc.links).toHaveLength(4);
    expect(acc.links.map((l) => l.label)).toEqual(["دليل الحسابات", "كشف حساب العميل", "المصروفات", "القوائم المالية"]);
  });

  it("shows a member only what they may open", () => {
    const { modules } = launcherTiles({ permissions: new Set(["inventory.view"]) });
    expect(modules.some((m) => m.label === "المخزون")).toBe(true);
    expect(modules.some((m) => m.label === "المحاسبة")).toBe(false);
  });

  it("drops a module the tenant isn't subscribed to, or the owner hid", () => {
    const labels = (o: { modules?: string[]; navHidden?: string[] }) =>
      launcherTiles({ permissions: everything, ...o }).modules.map((m) => m.label);
    expect(labels({ modules: ["sales"] })).not.toContain("المحاسبة");
    expect(labels({ navHidden: ["المستثمرون"] })).not.toContain("المستثمرون");
  });
});
