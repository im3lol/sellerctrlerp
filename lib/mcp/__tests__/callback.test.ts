import { describe, expect, it } from "vitest";
import { usesLocalCallbackPopup } from "../callback";

describe("OAuth browsing context", () => {
  it("only allows a separate handoff for local CLI callbacks", () => {
    for (const url of ["http://127.0.0.1:43189/callback", "http://localhost:3118/callback", "http://[::1]:3118/callback"]) expect(usesLocalCallbackPopup(url)).toBe(true);
    for (const url of ["https://chatgpt.com/connector_platform/oauth/redirect", "https://claude.ai/api/mcp/auth_callback", "https://client.example/callback", "https://localhost/callback", "http://localhost.example/callback", "http://127.0.0.1.example/callback", "invalid"]) expect(usesLocalCallbackPopup(url)).toBe(false);
  });
});
