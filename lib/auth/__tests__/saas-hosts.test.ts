import { afterEach, expect, it, vi } from "vitest";
import { applicationLoginDestination } from "../login-destination";
import { authConfig } from "../../../auth.config";

afterEach(() => vi.unstubAllEnvs());

it("allows only configured sibling origins after authentication", async () => {
  vi.stubEnv("APP_URL", "https://app.sellerctrl.com");
  vi.stubEnv("MARKETING_URL", "https://sellerctrl.com");
  const redirect = authConfig.callbacks.redirect;
  expect(await redirect({ url: "https://app.sellerctrl.com/dashboard", baseUrl: "https://sellerctrl.com" })).toBe("https://app.sellerctrl.com/dashboard");
  expect(await redirect({ url: "https://evil.example/steal", baseUrl: "https://sellerctrl.com" })).toBe("https://app.sellerctrl.com/dashboard");
  expect(await redirect({ url: "https://app.sellerctrl.com.evil.example/", baseUrl: "https://sellerctrl.com" })).toBe("https://app.sellerctrl.com/dashboard");
});

it("preserves local OAuth continuations when login starts on the marketing host", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", "https://app.sellerctrl.com");
  expect(applicationLoginDestination("/mcp/authorize?state=kept")).toBe("https://app.sellerctrl.com/mcp/authorize?state=kept");
  expect(applicationLoginDestination("//evil.example")).toBe("https://app.sellerctrl.com/dashboard");
  expect(applicationLoginDestination("/admin", "/admin")).toBe("https://app.sellerctrl.com/admin");
});
