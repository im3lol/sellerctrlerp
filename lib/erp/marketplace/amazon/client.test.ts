import { describe, it, expect, vi, afterEach } from "vitest";
import { paced, spFetch, spJson, withRequestCount, SpApiError, isAuthError } from "./client";
import type { Credential } from "../connector";

vi.mock("./lwa", () => ({
  refreshAccessToken: vi.fn(async (t: string) =>
    t.startsWith("bad")
      ? { error: "revoked", code: "invalid_grant" }
      : { access_token: `at-${t}`, expires_in: 3600 },
  ),
}));
import { refreshAccessToken } from "./lwa";

const cred = (token: string): Credential => ({ refreshToken: token, sellerId: `s-${token}`, marketplaceId: "M1", region: "eu" });
const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

afterEach(() => vi.unstubAllGlobals());

describe("paced", () => {
  it("serializes calls per key and spaces their starts by minInterval", async () => {
    const starts: number[] = [];
    const t0 = Date.now();
    const call = () => paced("k", 50, async () => { starts.push(Date.now() - t0); });
    await Promise.all([call(), call(), call()]);
    // three calls paced by 50ms → starts near 0, 50, 100 (allow slack)
    expect(starts).toHaveLength(3);
    expect(starts[1]).toBeGreaterThanOrEqual(45);
    expect(starts[2]).toBeGreaterThanOrEqual(95);
  });

  it("keeps different keys independent", async () => {
    const t0 = Date.now();
    const at: number[] = [];
    await Promise.all([
      paced("a", 200, async () => at.push(Date.now() - t0)),
      paced("b", 200, async () => at.push(Date.now() - t0)),
    ]);
    // both run immediately (different keys) — neither waits on the other
    expect(Math.max(...at)).toBeLessThan(150);
  });
});

describe("spJson error typing", () => {
  it("throws SpApiError with status/code on non-2xx and does not retry 400", async () => {
    const fetchMock = vi.fn(async () => jsonRes(400, { errors: [{ message: "bad input", code: "InvalidInput" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const err = (await spJson(cred("t400"), "/x").catch((e) => e)) as SpApiError;
    expect(err).toBeInstanceOf(SpApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("InvalidInput");
    expect(err.isAuth).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies LWA invalid_grant as an auth error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const err = (await spFetch(cred("bad-token"), "/x").catch((e) => e)) as SpApiError;
    expect(isAuthError(err)).toBe(true);
    expect(err.code).toBe("invalid_grant");
  });
});

describe("retry", () => {
  it("retries a 500 then succeeds", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? jsonRes(500, {}) : jsonRes(200, { ok: 1 }))));
    const res = await spJson<{ ok: number }>(cred("t500"), "/x");
    expect(res.ok).toBe(1);
    expect(n).toBe(2);
  }, 10_000);
});

describe("LWA cache singleflight", () => {
  it("two concurrent requests for one token mint once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, {})));
    const before = vi.mocked(refreshAccessToken).mock.calls.length;
    const c = cred("single");
    await Promise.all([spFetch(c, "/a"), spFetch(c, "/b")]);
    const mints = vi.mocked(refreshAccessToken).mock.calls.filter((a) => a[0] === "single").length;
    expect(mints).toBe(1);
    expect(vi.mocked(refreshAccessToken).mock.calls.length).toBe(before + 1);
  });
});

describe("withRequestCount", () => {
  it("counts every SP-API request inside the scope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, {})));
    const c = cred("count");
    const [, count] = await withRequestCount(async () => {
      await spFetch(c, "/a");
      await spFetch(c, "/b");
    });
    expect(count).toBe(2);
  });
});
