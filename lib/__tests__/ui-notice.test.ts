import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
import { splitNoticeUrl } from "../ui-notice-policy";
import { decodeNotice, encodeNotice, noticeCookieName } from "../ui-notice-payload";
import { noticeTarget, getPageNotice, consumeNotice } from "../ui-notice";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "private-unit-test-notice-key-not-a-production-secret"); });
afterEach(() => vi.unstubAllEnvs());
it("removes status flags but preserves filters, search and pagination", () => {
  const { clean, values } = splitNoticeUrl(new URL("https://storage.example/storage?created=1&view=files&q=sku&page=2"));
  expect(clean.search).toBe("?view=files&q=sku&page=2"); expect(values).toEqual({ created: "1" });
  expect(splitNoticeUrl(new URL("https://app.example/inventory/items?status=active&page=2")).clean.search).toBe("?status=active&page=2");
});
it("does not modify OAuth protocol errors or business identifiers", () => {
  const url = new URL("https://app.example/api/storage/google/callback?error=access_denied&code=private&state=bound");
  expect(splitNoticeUrl(url).clean.href).toBe(url.href);
  expect(splitNoticeUrl(new URL("https://app.example/sales/orders/new?fromRequisition=123")).values).toEqual({});
});
it("encrypts notices, binds them to their target and rejects tampering and expiry", () => {
  const token = encodeNotice("/admin/integrations", { cloudSaved: "1", access_token: "must-not-store" }, 1000)!;
  expect(token).not.toContain("cloudSaved");
  expect(decodeNotice(token, "/admin/integrations", 2000)?.values).toEqual({ cloudSaved: "1" });
  expect(decodeNotice(token, "/storage/admin", 2000)).toBeNull();
  expect(decodeNotice(token + "tamper", "/admin/integrations", 2000)).toBeNull();
  expect(decodeNotice(token, "/admin/integrations", 301001)).toBeNull();
  expect(encodeNotice("/api/storage/google/callback", { error: "protocol" })).toBeNull();
});
it("bounds cookie size and keeps separate destinations from overwriting each other", () => {
  expect(encodeNotice("/storage/cloud", { error: "漢".repeat(10000), connected: "漢".repeat(10000), uploaded: "漢".repeat(10000), disconnected: "漢".repeat(10000) })!.length).toBeLessThan(4096);
  expect(noticeCookieName("/storage")).not.toBe(noticeCookieName("/storage/cloud"));
});
it("sets a private notice and returns a clean server-action redirect target", async () => {
  expect(await noticeTarget("/admin/integrations?cloudSaved=1#google-drive")).toBe("/admin/integrations");
  const [name, token, options] = jar.set.mock.calls[0];
  expect(name).toBe(noticeCookieName("/admin/integrations"));expect(options.httpOnly).toBe(true);
  jar.get.mockReturnValue({ value: token });
  const notice = await getPageNotice("/admin/integrations");
  expect(notice.values).toEqual({ cloudSaved: "1" });
  await consumeNotice("/admin/integrations", "older-notice");expect(jar.set).toHaveBeenCalledTimes(1);
  await consumeNotice("/admin/integrations", notice.id);expect(jar.set.mock.calls[1][2].maxAge).toBe(0);
});
