import { describe, expect, it } from "vitest";
import { MCP_CLIENT_GUIDES, clientSetup } from "../client-guides";
import { translator } from "@/lib/i18n";

describe("self-service MCP setup", () => {
  const endpoint = "https://app.sellerctrl.com/mcp";
  it("gives every supported app translated steps and official HTTPS documentation", () => {
    expect(new Set(MCP_CLIENT_GUIDES.map(g => g.id)).size).toBe(7);
    for (const guide of MCP_CLIENT_GUIDES) {
      expect(new URL(guide.docs).protocol).toBe("https:");
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      for (const step of guide.steps) expect(translator("en")(step)).not.toMatch(/[\u0600-\u06ff]/);
    }
  });
  it("exports the client-specific JSON namespaces without tokens or company authority", () => {
    const cursor = JSON.parse(clientSetup("cursor", endpoint).content);
    const vscode = JSON.parse(clientSetup("vscode", endpoint).content);
    expect(cursor).toEqual({ mcpServers: { sellerctrl: { url: endpoint } } });
    expect(vscode).toEqual({ servers: { sellerctrl: { type: "http", url: endpoint } } });
    for (const guide of MCP_CLIENT_GUIDES) expect(clientSetup(guide.id, endpoint).content).not.toMatch(/Bearer|client_secret|organization_id|user_id|oauth_resource/);
  });
  it("keeps interactive slash commands out of shell setup commands", () => {
    for (const id of ["claude-code", "gemini-cli"] as const) expect(clientSetup(id, endpoint).content).not.toMatch(/^\/mcp/m);
    expect(clientSetup("codex", endpoint).content).not.toContain("mcp login");
    expect(clientSetup("codex", endpoint).reauth).toContain("mcp login sellerctrl");
  });
});
