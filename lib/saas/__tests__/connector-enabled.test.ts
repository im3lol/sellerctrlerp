import { describe, it, expect, vi, beforeEach } from "vitest";

// The readers resolve DB-first (platform_integrations via getIntegrationConfig) then env
// fallback. We mock the generic reader per connector code and assert the resolution rules.
type Cfg = { clientId: string; clientSecret: string; webhookSecret: string; appId: string | null; enabled: boolean | null };
const state: { byCode: Record<string, Partial<Cfg>> } = { byCode: {} };
const full = (code: string, o: Partial<Cfg>) => ({
  code, clientId: "", clientSecret: "", webhookSecret: "", redirectUri: null, scopes: null,
  region: null, apiVersion: null, appId: null, enabled: null, extra: {}, ...o,
});
vi.mock("../integration-config", () => ({
  getIntegrationConfig: async (code: string) => full(code.toUpperCase(), state.byCode[code.toUpperCase()] ?? {}),
  getIntegrationEnabled: async (code: string) => state.byCode[code.toUpperCase()]?.enabled ?? null,
}));

import { enabledConnectorCodes } from "../connector-enabled";
import { getAmazonConfig } from "../amazon-config";
import { getNoonConfig } from "../noon-config";

beforeEach(() => {
  state.byCode = {};
  delete process.env.SPAPI_LWA_CLIENT_ID; delete process.env.SPAPI_LWA_CLIENT_SECRET; delete process.env.SPAPI_APP_ID;
  delete process.env.NOON_CLIENT_ID; delete process.env.NOON_CLIENT_SECRET;
  delete process.env.SHOPIFY_ENABLED; delete process.env.NOON_ENABLED;
});

describe("enabledConnectorCodes — DB toggle over env, Amazon default on", () => {
  it("defaults: Amazon on, others off (no row, no env)", async () => {
    expect([...(await enabledConnectorCodes())]).toEqual(["AMAZON"]);
  });
  it("env flags enable Shopify/Noon when DB is null", async () => {
    process.env.SHOPIFY_ENABLED = "1"; process.env.NOON_ENABLED = "1";
    const s = await enabledConnectorCodes();
    expect(s.has("SHOPIFY")).toBe(true); expect(s.has("NOON")).toBe(true);
  });
  it("DB toggle wins over env (explicit false disables despite env=1)", async () => {
    process.env.NOON_ENABLED = "1";
    state.byCode = { NOON: { enabled: false }, AMAZON: { enabled: false } };
    const s = await enabledConnectorCodes();
    expect(s.has("NOON")).toBe(false);
    expect(s.has("AMAZON")).toBe(false); // explicit false overrides the default-on
  });
});

describe("getAmazonConfig / getNoonConfig — DB-first, env fallback, null when incomplete", () => {
  it("null when neither DB nor env has creds", async () => {
    expect(await getAmazonConfig()).toBeNull();
    expect(await getNoonConfig()).toBeNull();
  });
  it("env fallback fills missing halves", async () => {
    process.env.SPAPI_LWA_CLIENT_ID = "id"; process.env.SPAPI_LWA_CLIENT_SECRET = "sec"; process.env.SPAPI_APP_ID = "app";
    expect(await getAmazonConfig()).toEqual({ lwaClientId: "id", lwaClientSecret: "sec", appId: "app" });
  });
  it("DB row wins (secret already decrypted by the generic reader)", async () => {
    state.byCode = { AMAZON: { clientId: "dbid", clientSecret: "plain", appId: "dbapp" } };
    expect(await getAmazonConfig()).toEqual({ lwaClientId: "dbid", lwaClientSecret: "plain", appId: "dbapp" });
  });
});
