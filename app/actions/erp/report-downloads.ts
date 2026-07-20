"use server";

import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { reportDownloads } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

/** Record a report generation so it shows in the report center's re-download list. */
export async function recordReportDownloadAction(input: {
  reportKey: string;
  label: string;
  format: "pdf" | "excel";
  params?: string;
}): Promise<ActionState> {
  const auth = await authorizeErp("reports.view");
  if ("error" in auth) return auth;
  if (!input?.reportKey || !input?.label) return { error: "بيانات ناقصة" };

  return withOrgScope(auth.orgId, false, async () => {
    await db.insert(reportDownloads).values({
      organizationId: auth.orgId,
      reportKey: String(input.reportKey).slice(0, 80),
      label: String(input.label).slice(0, 160),
      format: input.format === "excel" ? "excel" : "pdf",
      params: String(input.params ?? "").slice(0, 400),
      createdById: auth.userId,
    });
    return { ok: true };
  });
}

/** Prune download history older than `days` (called by the daily cron). */
export async function pruneReportDownloads(days = 7): Promise<number> {
  const cutoff = new Date(Date.now() - days * 864e5);
  const r = await db.delete(reportDownloads).where(lt(reportDownloads.createdAt, cutoff)).returning({ id: reportDownloads.id });
  return r.length;
}
