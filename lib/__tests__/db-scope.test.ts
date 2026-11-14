import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ options: [] as unknown[], transactions: 0 }));
vi.mock("@/lib/db", async () => ({
  scopeStore: new (await import("node:async_hooks")).AsyncLocalStorage(),
  realDb: { transaction: async (fn: (tx: unknown) => unknown, options?:unknown) => {
    state.options.push(options);
    state.transactions++;
    return fn({ execute: vi.fn(async () => undefined) });
  } },
}));
import { withOrgScope, withPlatformScope, withOrgSnapshot } from "../db-scope";
import { scopeStore } from "../db";

beforeEach(() => { state.transactions = 0; state.options=[]; });
describe("database company boundaries", () => {
  it("reuses a matching tenant transaction", async () => {
    await withOrgScope("a", false, () => withOrgScope("a", false, async () => {
      expect(scopeStore.getStore()).toMatchObject({ orgId: "a", isPlatform: false });
    }));
    expect(state.transactions).toBe(1);
  });
  it("rejects switching tenants before the callback can read data", async () => {
    const read = vi.fn(async () => undefined);
    await expect(withOrgScope("a", false, () => withOrgScope("b", false, read))).rejects.toThrow("Cannot switch company");
    expect(read).not.toHaveBeenCalled();
  });
  it("narrows a platform bootstrap to a separate tenant transaction and restores context", async () => {
    await withPlatformScope(async () => {
      const parent = scopeStore.getStore();
      await withOrgScope("a", false, async () => {
        expect(scopeStore.getStore()).toMatchObject({ orgId: "a", isPlatform: false });
        expect(scopeStore.getStore()?.tx).not.toBe(parent?.tx);
      });
      expect(scopeStore.getStore()).toBe(parent);
    });
    expect(state.transactions).toBe(2);
  });
  it("never elevates an existing tenant via a platform helper", async () => {
    await withOrgScope("a", false, () => withPlatformScope(async () => {
      expect(scopeStore.getStore()).toMatchObject({ orgId: "a", isPlatform: false });
    }));
    expect(state.transactions).toBe(1);
  });
  it("isolates concurrent companies across asynchronous continuations", async () => {
    const observations = await Promise.all(["a", "b"].map(org => withOrgScope(org, false, async () => {
      await new Promise(resolve => setTimeout(resolve, org === "a" ? 5 : 1));
      return scopeStore.getStore()?.orgId;
    })));
    expect(observations).toEqual(["a", "b"]);
    expect(scopeStore.getStore()).toBeUndefined();
  });
  it("rejects bypass flags and missing companies", () => {
    expect(() => withOrgScope("", false, async () => undefined)).toThrow();
    expect(() => withOrgScope("a", true, async () => undefined)).toThrow();
  });
});

it("creates an independent repeatable-read, read-only company snapshot",async()=>{
 await withOrgScope("a",false,async()=>{
  const original=scopeStore.getStore();
  await withOrgSnapshot("a",async()=>{expect(scopeStore.getStore()?.tx).not.toBe(original?.tx);expect(scopeStore.getStore()?.orgId).toBe("a");});
  expect(scopeStore.getStore()).toBe(original);
  expect(()=>withOrgSnapshot("b",async()=>undefined)).toThrow("Cannot switch company");
 });
 expect(state.options[1]).toEqual({isolationLevel:"repeatable read",accessMode:"read only"});
});
