import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { syncRuns } from "@/db/schema";

// Durable log for the background sync workers (counts + timing + error). Job state
// itself lives in Redis; this survives restarts and drives the UI progress view.
export type SyncKind = "IMPORT" | "DISCOVERY" | "DETAILS" | "IMAGES" | "PRICING" | "INVENTORY" | "ORDERS" | "SETTLEMENTS";
export type SyncCounts = Partial<{
  productsProcessed: number; newProducts: number; updatedProducts: number; failedProducts: number; apiRequests: number;
}>;

export async function startRun(orgId: string, provider: string, kind: SyncKind, marketplace?: string | null): Promise<string> {
  return withOrgScope(orgId, false, async () => {
    const [row] = await db.insert(syncRuns)
      .values({ organizationId: orgId, provider, kind, marketplace: marketplace ?? null })
      .returning({ id: syncRuns.id });
    return row.id;
  });
}

export async function finishRun(orgId: string, id: string, status: "OK" | "FAILED", counts: SyncCounts = {}, error?: string): Promise<void> {
  await withOrgScope(orgId, false, () =>
    db.update(syncRuns).set({ status, finishedAt: new Date(), error: error ?? null, ...counts }).where(eq(syncRuns.id, id)));
}
