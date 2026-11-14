import { describe, it, expect, vi, afterEach } from "vitest";
import { digest, mcpUrls, opaque, parseScopes, pkceMatches, validRedirect } from "../policy";
import { readTextLimited } from "../http";
afterEach(() => vi.unstubAllEnvs());
describe("MCP OAuth boundaries", () => {
  it("requires a valid verifier bound to its S256 challenge", () => {
    const verifier = opaque();
    expect(pkceMatches(verifier, digest(verifier))).toBe(true);
    expect(pkceMatches(opaque(), digest(verifier))).toBe(false);
    expect(pkceMatches("short", digest(verifier))).toBe(false);
    expect(pkceMatches(verifier, "x")).toBe(false);
  });
  it("allows HTTPS and loopback callbacks, rejecting credentials, fragments and insecure remote callbacks", () => {
    expect(validRedirect("https://client.example/callback")).toBe(true);
    expect(validRedirect("http://127.0.0.1:4782/callback")).toBe(true);
    for (const uri of ["javascript:alert(1)", "http://remote.example/cb", "https://a:b@client.example/cb", "https://client.example/cb#code"]) expect(validRedirect(uri)).toBe(false);
  });
  it("does not allow write or unknown scopes", () => {
    expect(parseScopes("inventory.read inventory.read erp.identity")).toEqual(["inventory.read", "erp.identity"]);
    expect(() => parseScopes("accounting.post")).toThrow("invalid_scope");
    expect(() => parseScopes("__proto__")).toThrow("invalid_scope");
  });
  it("binds audience to a configured canonical endpoint, never the request Host", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("MCP_PUBLIC_URL", "https://erp.example/mcp");
    expect(mcpUrls().resource).toBe("https://erp.example/mcp");
    vi.stubEnv("MCP_PUBLIC_URL", "http://erp.example/mcp");
    expect(() => mcpUrls()).toThrow("HTTPS");
  });
  it("rejects oversized request bodies even without Content-Length", async () => {
    const req = new Request("https://erp.example/mcp", { method: "POST", body: "x".repeat(32) });
    await expect(readTextLimited(req, 16)).rejects.toThrow("request_too_large");
  });
});
