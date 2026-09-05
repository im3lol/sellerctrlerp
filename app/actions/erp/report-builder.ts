"use server";

import { z } from "zod";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { savedReports } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { EXPORT_DATASETS } from "@/lib/erp/export-datasets";
import { runReport, validateSpec, type Cell, type ReportSpec, type ReportResult } from "@/lib/erp/report-builder";

/**
 * The report builder's server half. It runs the dataset's own read-only fetcher and hands
 * the rows to the pure engine — so a built report can never reach data an export could
 * not, and can never write anything.
 */

const filterSchema = z.object({
  column: z.coerce.number().int().min(0),
  op: z.enum(["eq", "ne", "contains", "notContains", "gt", "gte", "lt", "lte", "between", "empty", "notEmpty"]),
  value: z.string().max(200).optional(),
  value2: z.string().max(200).optional(),
});

const specSchema = z.object({
  columns: z.array(z.coerce.number().int().min(0)).max(40).default([]),
  filters: z.array(filterSchema).max(10).default([]),
  groupBy: z.coerce.number().int().min(0).nullable().default(null),
  aggregates: z.array(z.object({
    column: z.coerce.number().int().min(0),
    agg: z.enum(["sum", "avg", "count", "min", "max"]),
  })).max(8).default([]),
  sort: z.object({ column: z.coerce.number().int().min(0), dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  limit: z.coerce.number().int().min(0).max(5000).optional(),
});

export type RunReportResult = ReportResult & { datasetTitle: string; allHeaders: string[] };

/** Run a spec against a dataset the caller is allowed to export. */
export async function runReportAction(dataset: string, spec: unknown): Promise<ActionState & { result?: RunReportResult }> {
  const ds = EXPORT_DATASETS[dataset];
  if (!ds) return { error: "التقرير ده مش موجود" };

  // The dataset's own module permission — the builder grants no new access.
  const auth = await authorizeErp(ds.module);
  if ("error" in auth) return auth;

  const parsed = specSchema.safeParse(spec ?? {});
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const bad = validateSpec(parsed.data as ReportSpec, ds.headers.length);
  if (bad) return { error: bad };

  return withOrgScope(auth.orgId, false, async () => {
    const rows = (await ds.fetch(auth.orgId)) as Cell[][];
    const result = runReport(ds.headers, rows, parsed.data as ReportSpec);
    return { ok: true, result: { ...result, datasetTitle: ds.title, allHeaders: ds.headers } };
  });
}

const saveSchema = z.object({
  id: z.string().optional(),
  nameAr: z.string().trim().min(1, "اكتب اسم التقرير").max(120),
  dataset: z.string().min(1),
  spec: specSchema,
  isShared: z.boolean().default(false),
});

export async function saveReportAction(input: z.input<typeof saveSchema>): Promise<ActionState & { id?: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const ds = EXPORT_DATASETS[d.dataset];
  if (!ds) return { error: "التقرير ده مش موجود" };
  const auth = await authorizeErp(ds.module);
  if ("error" in auth) return auth;

  const bad = validateSpec(d.spec as ReportSpec, ds.headers.length);
  if (bad) return { error: bad };

  return withOrgScope(auth.orgId, false, async () => {
    if (d.id) {
      const [existing] = await db.select({ id: savedReports.id, createdBy: savedReports.createdBy })
        .from(savedReports)
        .where(and(eq(savedReports.id, d.id), eq(savedReports.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "التقرير غير موجود" };
      // A shared report belongs to whoever built it; others save a copy instead.
      if (existing.createdBy && existing.createdBy !== auth.userId) {
        return { error: "التقرير ده بتاع حد تاني — احفظه باسم جديد" };
      }
      await db.update(savedReports).set({
        nameAr: d.nameAr, spec: d.spec as ReportSpec, isShared: d.isShared, updatedAt: new Date(),
      }).where(eq(savedReports.id, d.id));
      revalidatePath("/reports/builder");
      return { ok: true, id: d.id };
    }

    const [row] = await db.insert(savedReports).values({
      organizationId: auth.orgId, nameAr: d.nameAr, dataset: d.dataset,
      spec: d.spec as ReportSpec, isShared: d.isShared, createdBy: auth.userId,
    }).returning({ id: savedReports.id });

    revalidatePath("/reports/builder");
    return { ok: true, id: row.id };
  });
}

export async function deleteReportAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("reports.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [existing] = await db.select({ id: savedReports.id, createdBy: savedReports.createdBy })
      .from(savedReports)
      .where(and(eq(savedReports.id, id), eq(savedReports.organizationId, auth.orgId))).limit(1);
    if (!existing) return { error: "التقرير غير موجود" };
    if (existing.createdBy && existing.createdBy !== auth.userId) return { error: "التقرير ده بتاع حد تاني" };

    await db.delete(savedReports).where(eq(savedReports.id, id));
    revalidatePath("/reports/builder");
    return { ok: true };
  });
}

export type SavedReportRow = { id: string; nameAr: string; dataset: string; datasetTitle: string; spec: ReportSpec; isShared: boolean; mine: boolean };

/** The caller's own reports plus anything shared with the org. */
export async function listSavedReportsAction(): Promise<ActionState & { rows?: SavedReportRow[] }> {
  const auth = await authorizeErp("reports.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select().from(savedReports)
      .where(and(
        eq(savedReports.organizationId, auth.orgId),
        or(eq(savedReports.isShared, true), eq(savedReports.createdBy, auth.userId)),
      ))
      .orderBy(asc(savedReports.nameAr));

    return {
      ok: true,
      rows: rows
        // A report on a dataset the caller cannot export is not shown at all.
        .filter((r) => EXPORT_DATASETS[r.dataset])
        .map((r) => ({
          id: r.id, nameAr: r.nameAr, dataset: r.dataset,
          datasetTitle: EXPORT_DATASETS[r.dataset].title,
          spec: r.spec, isShared: r.isShared, mine: r.createdBy === auth.userId,
        })),
    };
  });
}
