import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "Latest stock balance" is the newest movement per item+warehouse. Rows written in one
 * transaction share created_at, so the tie-break is the movement number — and it must
 * be compared as a NUMBER. As text "SM-2026-9999" sorts after "SM-2026-10001", so once a
 * year passes 9,999 movements every reader sorting as text picks a stale row.
 *
 * The engine (lib/erp/inventory.ts) always sorted numerically and said so in a comment;
 * fifteen readers — the dashboard, the bell, the inventory landing, dead stock, reorder,
 * transfers, cycle count, the FBA audit — sorted as text. This keeps it from coming back.
 */

function sourceFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
    .map((f) => join(dir, f));
}

describe("latest-balance ordering", () => {
  it("no reader tie-breaks the movement number as text", () => {
    const offenders = [...sourceFiles("lib"), ...sourceFiles("app")]
      .filter((f) => /created_at DESC,\s*number DESC/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
