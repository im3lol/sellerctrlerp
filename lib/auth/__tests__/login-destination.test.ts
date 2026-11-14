import { describe, expect, it } from "vitest";
import { loginDestination } from "../login-destination";

describe("login continuation", () => {
  it("preserves an MCP request including the encoded client callback and PKCE parameters", () => {
    const path = "/mcp/authorize?client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1%3A62824%2Fcallback&scope=erp.identity+inventory.read&state=state&code_challenge=challenge";
    expect(loginDestination(path)).toBe(path);
    expect(loginDestination(path, "/admin")).toBe(path);
  });
  it.each([undefined, ["/apps"], "https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example", "/login?callbackUrl=/apps", "/signup", "/x/../login"]) ("rejects unsafe or looping destinations: %s", value => {
    expect(loginDestination(value, "/admin")).toBe("/admin");
  });
  it("keeps normal landing defaults", () => {
    expect(loginDestination(undefined)).toBe("/apps");
    expect(loginDestination("/reports?date=2026-10-18")).toBe("/reports?date=2026-10-18");
  });
});
