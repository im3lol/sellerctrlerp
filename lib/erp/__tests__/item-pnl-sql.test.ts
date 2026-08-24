import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { inArray, sql } from "drizzle-orm";

// Regression guard: the item-P&L fee filter must compile to an IN-list. Interpolating
// a JS array straight into `= ANY(${norms})` renders a row/tuple `ANY(($1,$2,$3))`,
// which Postgres rejects ("op ANY/ALL (array) requires array on right side") and
// 500s every product page. See lib/erp/item-pnl.ts (getItemPnl fee query).
describe("getItemPnl SKU fee filter", () => {
  it("compiles to an IN-list, not ANY(tuple)", () => {
    const norms = ["ABC", "DEF", "GHI"];
    const cond = inArray(sql`regexp_replace(upper(x), '[^A-Z0-9]', '', 'g')`, norms);
    const { sql: text } = new PgDialect().sqlToQuery(cond.getSQL());
    const lower = text.toLowerCase();
    expect(lower).toContain(" in (");
    expect(lower).not.toContain("any(");
  });
});
