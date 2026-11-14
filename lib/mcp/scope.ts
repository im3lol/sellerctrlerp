import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { getErpContext } from "@/lib/erp/erp-context";

/** Personal MCP tables require both company scope and a fixed user GUC. */
export function withMcpUserScope<T>(orgId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = getErpContext();
  if (ctx && (ctx.orgId !== orgId || ctx.userId !== userId || ctx.system)) throw new Error("Invalid MCP identity scope");
  return withOrgScope(orgId, false, async () => {
    const current = (await db.execute<{ actor: string | null }>(sql`select current_setting('app.mcp_user', true) actor`)).rows[0]?.actor;
    if (current && current !== userId) throw new Error("Cannot switch MCP user in a transaction");
    await db.execute(sql`select set_config('app.mcp_user', ${userId}, true)`);
    return fn();
  });
}
