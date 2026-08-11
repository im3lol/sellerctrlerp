import "server-only";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { reportDownloads } from "@/db/schema";

/**
 * Prune report-download history older than `days`. Cron-only maintenance.
 *
 * SECURITY: a plain server-only helper, NOT a server action — it deletes across ALL
 * orgs, so it must never be exported from a `"use server"` module (that would make it
 * a callable endpoint). `days` is clamped to ≥1 so a negative/zero value can't push the
 * cutoff into the future and wipe recent — or all — rows. Runs under platform scope.
 */
export async function pruneReportDownloads(days = 7): Promise<number> {
  const d = Math.max(1, Math.floor(Number(days) || 7));
  const cutoff = new Date(Date.now() - d * 864e5);
  return withPlatformScope(async () => {
    const r = await db.delete(reportDownloads).where(lt(reportDownloads.createdAt, cutoff)).returning({ id: reportDownloads.id });
    return r.length;
  });
}
