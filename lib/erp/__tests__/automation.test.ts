import { describe, it, expect } from "vitest";
import {
  checkCondition, matches, fill, validateSpec, fieldsOf, TEMPLATES, DOCS, OPS_FOR,
  type RuleSpec, type Facts,
} from "@/lib/erp/automation/model";

const rule = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  trigger: { kind: "event", entity: "SALES_ORDER", event: "CONFIRM" },
  match: "all", conditions: [],
  actions: [{ type: "notify", to: { creator: true }, message: "أمر {number}" }],
  ...over,
});
const facts: Facts = { number: "SO-2026-0007", status: "CONFIRMED", total: 62500, date: "2026-09-17", party: "شركة النور", channel: "AMAZON", dueDate: null };

describe("a condition", () => {
  it("compares numbers as numbers", () => {
    expect(checkCondition({ field: "total", op: "gt", value: "50,000" }, facts, "number")).toBe(true);
    expect(checkCondition({ field: "total", op: "lte", value: "62500" }, facts, "number")).toBe(true);
    expect(checkCondition({ field: "total", op: "lt", value: "abc" }, facts, "number")).toBe(false);
  });

  it("compares text without caring about case, and dates in order", () => {
    expect(checkCondition({ field: "channel", op: "eq", value: "amazon" }, facts, "text")).toBe(true);
    expect(checkCondition({ field: "party", op: "contains", value: "النور" }, facts, "text")).toBe(true);
    expect(checkCondition({ field: "date", op: "gte", value: "2026-09-01" }, facts, "date")).toBe(true);
    expect(checkCondition({ field: "date", op: "lt", value: "2026-09-17" }, facts, "date")).toBe(false);
  });

  it("treats a missing value as empty — it matches «not equal», never «greater than»", () => {
    expect(checkCondition({ field: "dueDate", op: "empty" }, facts, "date")).toBe(true);
    expect(checkCondition({ field: "dueDate", op: "ne", value: "2026-01-01" }, facts, "date")).toBe(true);
    expect(checkCondition({ field: "dueDate", op: "gt", value: "2026-01-01" }, facts, "date")).toBe(false);
  });
});

describe("a rule's conditions", () => {
  it("passes every document when there are none", () => {
    expect(matches(rule(), facts)).toBe(true);
  });

  it("needs all of them, or any one", () => {
    const conditions = [
      { field: "total", op: "gt" as const, value: "100000" },
      { field: "channel", op: "eq" as const, value: "AMAZON" },
    ];
    expect(matches(rule({ conditions }), facts)).toBe(false);
    expect(matches(rule({ conditions, match: "any" }), facts)).toBe(true);
  });
});

describe("a message", () => {
  it("fills the document's values in, and leaves unknown ones empty", () => {
    expect(fill("{doc} {number} — {party} — {total}{nope}", facts, { doc: "أمر بيع" }))
      .toBe("أمر بيع SO-2026-0007 — شركة النور — 62,500");
  });
});

describe("saving a rule", () => {
  it("accepts a sound rule", () => {
    expect(validateSpec(rule({ conditions: [{ field: "total", op: "gt", value: "10" }] }))).toBeNull();
  });

  it("refuses what it can't run", () => {
    expect(validateSpec(rule({ trigger: { kind: "event", entity: "NOPE", event: "CONFIRM" } }))).toMatch(/نوع المستند/);
    expect(validateSpec(rule({ conditions: [{ field: "salary", op: "gt", value: "1" }] }))).toMatch(/حقل/);
    expect(validateSpec(rule({ conditions: [{ field: "total", op: "contains", value: "1" }] }))).toMatch(/مقارنة/);
    expect(validateSpec(rule({ conditions: [{ field: "total", op: "gt", value: "كتير" }] }))).toMatch(/رقم/);
    expect(validateSpec(rule({ actions: [] }))).toMatch(/إجراء/);
    expect(validateSpec(rule({ actions: [{ type: "notify", to: {}, message: "x" }] }))).toMatch(/حد يوصله/);
    expect(validateSpec(rule({ actions: [{ type: "webhook", url: "http://example.com" }] }))).toMatch(/https/);
  });

  it("keeps comments and follow-ups to documents that have a conversation", () => {
    const expense = rule({ trigger: { kind: "event", entity: "EXPENSE", event: "CREATE" } });
    expect(validateSpec({ ...expense, actions: [{ type: "comment", body: "x" }] })).toMatch(/مش متاحة/);
    expect(validateSpec({ ...expense, actions: [{ type: "notify", to: { roles: ["admin"] }, message: "x" }] })).toBeNull();
  });
});

describe("the document registry and templates", () => {
  it("offers the party and warehouse where a document has them", () => {
    expect(fieldsOf("PURCHASE_ORDER").map((f) => f.key)).toEqual(expect.arrayContaining(["total", "party", "warehouse"]));
    expect(fieldsOf("JOURNAL_ENTRY").map((f) => f.key)).not.toContain("party");
    expect(Object.keys(DOCS).length).toBeGreaterThanOrEqual(15);
    expect(OPS_FOR.number).not.toContain("contains");
  });

  it("ships only templates that would save", () => {
    // The webhook template carries a placeholder URL on purpose — the user sets theirs.
    for (const t of TEMPLATES) expect([t.key, validateSpec(t.spec)]).toEqual([t.key, null]);
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
  });
});
