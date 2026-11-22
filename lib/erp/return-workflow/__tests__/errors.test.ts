import { describe, expect, it } from "vitest";
import { arabicReturnError } from "../errors";

describe("arabicReturnError", () => {
  it("translates known engine messages", () => {
    expect(arabicReturnError("Claim not found")).toBe("المطالبة غير موجودة");
  });
  it("passes Arabic through and never returns English", () => {
    expect(arabicReturnError("المرتجع غير موجود")).toBe("المرتجع غير موجود");
    expect(arabicReturnError("Return case changed; refresh the preview")).toMatch(/[؀-ۿ]/);
    expect(arabicReturnError("something unexpected")).toMatch(/[؀-ۿ]/);
  });
});
