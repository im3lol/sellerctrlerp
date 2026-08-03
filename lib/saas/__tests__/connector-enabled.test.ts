import { describe, it, expect, vi, beforeEach } from "vitest";

// The readers select the platform_settings singleton then apply DB-first + env-fallback
// logic. We mock the db row and env, and assert the resolution rules.

const state: { row: Record<string, unknown> | undefined } = { row: undefined };
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ limit: async () => (state.row ? [state.row] : []) }) }) },
}));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (s: string) => `dec(${s})` }));

import { enabledConnectorCodes } from "../connector-enabled";
import { getAmazonConfig } from "../amazon-config";
import { getNoonConfig } from "../noon-config";

beforeEach(() => {
  state.row = undefined;
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
    state.row = { noonEnabled: false, amazonEnabled: false };
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
  it("DB row wins and its secret is decrypted", async () => {
    state.row = { amazonLwaClientId: "dbid", amazonLwaClientSecret: "ct", amazonAppId: "dbapp" };
    expect(await getAmazonConfig()).toEqual({ lwaClientId: "dbid", lwaClientSecret: "dec(ct)", appId: "dbapp" });
  });
});
