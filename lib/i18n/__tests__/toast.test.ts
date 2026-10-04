import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// sonner is a UI library; record what reaches it instead of rendering anything.
const calls: { kind: string; msg: unknown; opts: unknown }[] = [];
vi.mock("sonner", () => {
  const rec = (kind: string) => (msg: unknown, opts?: unknown) => { calls.push({ kind, msg, opts }); return 1; };
  return {
    toast: Object.assign(rec("default"), {
      success: rec("success"), error: rec("error"), info: rec("info"),
      warning: rec("warning"), message: rec("message"), loading: rec("loading"),
      dismiss: vi.fn(),
    }),
  };
});

const setLang = (lang: string) => {
  (globalThis as { document?: unknown }).document = { documentElement: { lang } };
};

describe("translated toast", () => {
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  it("translates a server message in English", async () => {
    setLang("en");
    const { toast } = await import("@/lib/i18n/toast");
    toast.error("الفاتورة غير موجودة");
    toast.success("تم حفظ التعديلات", { description: "تعذّر الحفظ" });
    expect(calls[0]).toMatchObject({ kind: "error", msg: "Invoice not found" });
    expect(calls[1]).toMatchObject({ kind: "success", msg: "Changes saved", opts: { description: "Couldn't save" } });
  });

  it("leaves Arabic untouched in Arabic, and passes through what has no entry", async () => {
    const { toast } = await import("@/lib/i18n/toast");
    setLang("ar");
    toast.error("الفاتورة غير موجودة");
    setLang("en");
    toast.error("رسالة فيها رقم 42 مش في القاموس");
    toast.error("Already English");
    expect(calls.map((c) => c.msg)).toEqual(["الفاتورة غير موجودة", "رسالة فيها رقم 42 مش في القاموس", "Already English"]);
  });

  it("keeps the rest of sonner's API", async () => {
    const { toast } = await import("@/lib/i18n/toast");
    expect(typeof toast.dismiss).toBe("function");
  });
});
