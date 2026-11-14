import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const state = vi.hoisted(() => ({ results: [] as unknown[][], predicates: [] as unknown[] }));
vi.mock("@/lib/db", () => ({ db: { select: () => {
  const result = state.results.shift();
  const query = {
    from: () => query, innerJoin: () => query, leftJoin: () => query,
    where: (predicate: unknown) => { state.predicates.push(predicate); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} } }));
vi.mock("@/lib/erp/sales-cogs", () => ({ itemSalesCogs: async () => 0, platformSalesCogs: async () => 0 }));
vi.mock("@/lib/cache", () => ({ cached: (_key: string, _ttl: number, compute: () => unknown) => compute(), orgKey: (...parts: string[]) => parts.join(":") }));
import { getItemPnl } from "../item-pnl";
import { getPlatformPnl } from "../platform-pnl";

beforeEach(() => { state.results = []; state.predicates = []; });
const fees = { referral: "0", fba: "0", other: "0", n: "0" };

describe("P&L recognizes financial credit notes", () => {
  it("a fully returned item has zero net units and revenue", async () => {
    state.results = [[], [{ units: "1", revenue: "100" }], [fees], [{ units: "1", revenue: "100" }]];
    const result = await getItemPnl("tenant-a", "item-a", "SKU-1");
    expect(result).toMatchObject({ units: 0, revenue: 0, net: 0 });
    const predicate = new PgDialect().sqlToQuery(state.predicates.at(-1) as never);
    expect(predicate.params).toContain("tenant-a");
    expect(predicate.params).toContain("item-a");
    expect(predicate.params).toContain("POSTED");
    expect(predicate.sql).toContain('"delivery_note_id" is null');
  });
  it("a marketplace deducts only the authorized platform's financial returns", async () => {
    state.results = [[{ units: "3", revenue: "300" }], [fees], [{ units: "1", revenue: "100" }]];
    const result = await getPlatformPnl("tenant-b", "AMAZON", "platform-b");
    expect(result).toMatchObject({ units: 2, revenue: 200, net: 200 });
    const predicate = new PgDialect().sqlToQuery(state.predicates.at(-1) as never);
    expect(predicate.params).toEqual(expect.arrayContaining(["tenant-b", "POSTED", "platform-b", "AMAZON"]));
    expect(predicate.sql).toContain('"delivery_note_id" is null');
  });
});
