import { describe, expect, it } from "vitest";
import { z } from "zod";
import { str } from "@/lib/erp/form-value";

describe("str — FormData null at the schema boundary", () => {
  it("turns an absent field into undefined, not null", () => {
    const fd = new FormData();
    fd.set("nameAr", "تاليا شنط");
    expect(str(fd.get("nameAr"))).toBe("تاليا شنط");
    expect(str(fd.get("code"))).toBeUndefined(); // never rendered by the quick-create form
  });

  it("keeps an empty string as an empty string", () => {
    // A rendered-but-blank input is NOT the same as an absent one: the auto-code path keys
    // off `code === ""` to decide it should generate one.
    const fd = new FormData();
    fd.set("code", "");
    expect(str(fd.get("code"))).toBe("");
  });

  it("is what makes an optional field actually optional", () => {
    const schema = z.object({ code: z.string().optional(), nameAr: z.string().min(2) });
    const fd = new FormData();
    fd.set("nameAr", "عميل جديد");

    // The shape that shipped the bug — null reaches an optional string and it throws.
    expect(schema.safeParse({ code: fd.get("code"), nameAr: fd.get("nameAr") }).success).toBe(false);
    // Normalised, the same submission is valid.
    expect(schema.safeParse({ code: str(fd.get("code")), nameAr: str(fd.get("nameAr")) }).success).toBe(true);
  });

  it("still rejects a missing REQUIRED field, with that field's own message", () => {
    const schema = z.object({ nameAr: z.string().min(2, "الاسم قصير جداً") });
    const r = schema.safeParse({ nameAr: str(new FormData().get("nameAr")) });
    expect(r.success).toBe(false);
  });
});
