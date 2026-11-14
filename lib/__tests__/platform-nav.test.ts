import { describe, expect, it } from "vitest";
import { platformNavItems } from "@/lib/platform-nav";
import { erpAllows } from "@/lib/nav-access";

describe("Amazon monitoring navigation", () => {
  const platform = { id: "p", name: "Amazon", code: "AMAZON", integrationType: "amazon" };
  it("keeps saved-offer monitoring reachable when the platform is inactive, without sync tools", () => {
    const rows = platformNavItems({ ...platform, isActive: false });
    expect(rows.map(r => r.href)).toEqual(["/platforms/amazon/buy-box"]);
    expect(erpAllows(rows[0], new Set(["sales.view"]))).toBe(true);
    expect(erpAllows(rows[0], new Set(["inventory.view"]))).toBe(false);
  });
  it("retains all operational shortcuts for active Amazon channels, including custom codes", () => {
    const rows = platformNavItems({ ...platform, code: "AMAZON-EG", isActive: true });
    expect(rows).toHaveLength(9);
    expect(rows.some(r => r.href === "/platforms/amazon-eg/buy-box")).toBe(true);
    expect(rows.some(r => r.href === "/platforms/amazon-eg/import")).toBe(true);
  });
  it("does not offer Amazon monitoring on other providers", () => {
    const noon = { ...platform, code: "NOON", integrationType: "noon" };
    expect(platformNavItems({ ...noon, isActive: false })).toEqual([]);
    expect(platformNavItems({ ...noon, isActive: true }).map(r => r.href)).toEqual(["/platforms/noon"]);
  });
});
