import {beforeEach,describe,expect,it,vi} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
const mock=vi.hoisted(()=>({select:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{select:mock.select}}));
vi.mock("@/lib/db-scope",()=>({withOrgScope:(_org:string,_platform:boolean,fn:()=>unknown)=>fn()}));
import {getExchangeRate,getLatestExchangeRate} from "../currency";
const q={from:vi.fn(),where:vi.fn(),orderBy:vi.fn(),limit:vi.fn()};
beforeEach(()=>{
 vi.clearAllMocks();mock.select.mockReturnValue(q);
 q.from.mockReturnValue(q);q.where.mockReturnValue(q);q.orderBy.mockReturnValue(q);q.limit.mockResolvedValue([]);
});
describe("purchase default and historical FX are distinct",()=>{
 it("uses the newest recorded precise rate without an order-date cutoff",async()=>{
  q.limit.mockResolvedValueOnce([{rate:"52.500605"}]);
  expect(await getLatestExchangeRate("company-a","usd","EGP")).toBe(52.500605);
  const where=new PgDialect().sqlToQuery(q.where.mock.calls[0][0]);
  expect(where.params).toEqual(["company-a","USD"]);
  expect(where.sql).not.toContain("<=");expect(q.orderBy).toHaveBeenCalledOnce();
 });
 it("preserves the effective-date cutoff for historical accounting",async()=>{
  q.limit.mockResolvedValueOnce([{rate:"50"}]);const date=new Date("2026-01-10T00:00:00Z");
  expect(await getExchangeRate("company-a","USD","EGP",date)).toBe(50);
  const where=new PgDialect().sqlToQuery(q.where.mock.calls[0][0]);
  expect(where.sql).toContain("<=");expect(where.params.slice(0,2)).toEqual(["company-a","USD"]);
  expect(where.params).toHaveLength(3);
 });
 it("uses the company's currency snapshot only when history is absent",async()=>{
  q.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{rate:"14.9338"}]);
  expect(await getLatestExchangeRate("company-a","AED","EGP")).toBe(14.9338);
  const where=new PgDialect().sqlToQuery(q.where.mock.calls[1][0]);
  expect(where.params).toEqual(["company-a","AED"]);
 });
 it("does not invent a foreign rate of one when no rate exists",async()=>{
  expect(await getLatestExchangeRate("company-a","USD","EGP")).toBe(0);
 });
 it("always prices the base currency at one without a foreign lookup",async()=>{
  expect(await getLatestExchangeRate("company-a","egp","EGP")).toBe(1);
  expect(mock.select).not.toHaveBeenCalled();
 });
});
