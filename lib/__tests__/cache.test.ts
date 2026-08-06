import { describe, it, expect, beforeEach } from "vitest";
import { cached, orgKey, clearCache } from "../cache";

beforeEach(() => clearCache());

describe("orgKey — tenant-scoped key (the one correctness rule)", () => {
  it("always starts with the org id and never collides across orgs", () => {
    expect(orgKey("orgA", "pnl", "AMAZON", null).startsWith("orgA|")).toBe(true);
    // same params, different org → different key → org A's cache can't serve org B
    expect(orgKey("orgA", "pnl", "AMAZON", "c1")).not.toBe(orgKey("orgB", "pnl", "AMAZON", "c1"));
  });
});

describe("cached — memoize within TTL, cross-tenant isolation", () => {
  it("runs fn once within the TTL, again after it expires", async () => {
    let calls = 0;
    const run = () => cached("k", 50, async () => { calls++; return calls; });
    expect(await run()).toBe(1);
    expect(await run()).toBe(1);          // hit — fn not re-run
    await new Promise((r) => setTimeout(r, 60));
    expect(await run()).toBe(2);          // expired — recomputed
  });

  it("two orgs with the same params get their own cached values", async () => {
    const pnl = (org: string, v: number) => cached(orgKey(org, "pnl"), 1000, async () => v);
    expect(await pnl("orgA", 100)).toBe(100);
    expect(await pnl("orgB", 200)).toBe(200); // NOT org A's 100
    expect(await pnl("orgA", 999)).toBe(100); // org A still its own cached value
  });
});
