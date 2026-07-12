import { describe, it, expect } from "vitest";
import { validateParentLink } from "@/lib/erp/item-family-core";

const base = { childId: "c", parentId: "p", parentExists: true, parentHasParent: false, childHasChildren: false };

describe("validateParentLink", () => {
  it("allows a valid one-level link", () => {
    expect(validateParentLink(base)).toBeNull();
  });

  it("allows unlinking (empty parent)", () => {
    expect(validateParentLink({ ...base, parentId: "" })).toBeNull();
  });

  it("rejects self-parenting", () => {
    expect(validateParentLink({ ...base, parentId: "c" })).toMatch(/بنفسه/);
  });

  it("rejects a missing / cross-org parent", () => {
    expect(validateParentLink({ ...base, parentExists: false })).toMatch(/غير موجود/);
  });

  it("rejects a parent that is itself a variation (keeps one level)", () => {
    expect(validateParentLink({ ...base, parentHasParent: true })).toMatch(/مستوى واحد/);
  });

  it("rejects turning a family head into a child", () => {
    expect(validateParentLink({ ...base, childHasChildren: true })).toMatch(/أب لتنويعات/);
  });
});
