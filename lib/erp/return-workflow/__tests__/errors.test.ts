import { describe, expect, it } from "vitest";
import { arabicReturnError } from "../errors";

describe("arabicReturnError", () => {
  it("translates known engine messages", () => {
    expect(arabicReturnError("Claim not found")).toBe("المطالبة غير موجودة");
  });
  it("explains a missing Amazon receipt instead of the generic fallback", () => {
    const msg = arabicReturnError("An Amazon receipt requires FBA source evidence");
    expect(msg).toContain("وصل إلى مخزني");
    expect(msg).not.toBe(arabicReturnError("something unexpected"));
  });
  it("passes Arabic through and never returns English", () => {
    expect(arabicReturnError("المرتجع غير موجود")).toBe("المرتجع غير موجود");
    expect(arabicReturnError("Return case changed; refresh the preview")).toMatch(/[؀-ۿ]/);
    expect(arabicReturnError("something unexpected")).toMatch(/[؀-ۿ]/);
  });
});
