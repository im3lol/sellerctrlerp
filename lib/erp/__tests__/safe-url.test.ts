import { describe, it, expect } from "vitest";
import { isBlockedHost } from "@/lib/erp/marketplace/safe-url";
import { validateStoreUrl } from "@/lib/erp/marketplace/woo/constants";

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local and metadata addresses", () => {
    for (const h of [
      "127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.5", "172.31.255.1",
      "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1",
      "::ffff:127.0.0.1",
    ]) expect(isBlockedHost(h), h).toBe(true);
  });

  it("blocks intranet names", () => {
    for (const h of ["localhost", "db.localhost", "postgres", "app.local", "svc.internal"])
      expect(isBlockedHost(h), h).toBe(true);
  });

  it("allows ordinary public hosts", () => {
    for (const h of ["shop.example.com", "متجر.com", "172.32.0.1", "8.8.8.8", "example.co.uk"])
      expect(isBlockedHost(h), h).toBe(false);
  });
});

describe("validateStoreUrl", () => {
  it("keeps a clean https origin", () => {
    expect(validateStoreUrl("https://shop.example.com/wp-json/?x=1")).toBe("https://shop.example.com");
    expect(validateStoreUrl("shop.example.com")).toBe("https://shop.example.com");
  });

  it("refuses http and internal targets", () => {
    expect(validateStoreUrl("http://shop.example.com")).toBeNull();
    expect(validateStoreUrl("https://127.0.0.1")).toBeNull();
    expect(validateStoreUrl("https://169.254.169.254/latest/meta-data")).toBeNull();
    expect(validateStoreUrl("https://localhost:9000")).toBeNull();
    expect(validateStoreUrl("")).toBeNull();
  });
});
