import { and, eq, isNull, isNotNull, ne, or } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { products, scrapeJobs } from "@/db/schema";
import { scraperTokenOk, jsonCors } from "@/lib/scrape";

export const runtime = "nodejs";

/**
 * The Docker worker polls this to claim the next pending worker job. The item
 * list is recomputed LIVE from current product state — so a job that resumes
 * after a crash only re-scrapes drafts that are still incomplete (unless the
 * job is "all"/overwrite). Atomic claim via FOR UPDATE SKIP LOCKED.
 */
export async function GET(req: Request) {
  if (!scraperTokenOk(req)) return jsonCors({ error: "unauthorized" }, 401);

  const { rows } = await pool.query(
    `UPDATE scrape_jobs
        SET status = 'running', started_at = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM scrape_jobs
         WHERE status = 'pending' AND runner = 'worker'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, workspace_id, fields, target, overwrite`,
  );

  if (rows.length === 0) return new Response(null, { status: 204 });
  const job = rows[0];

  // Recompute the work list from the current state of the workspace's drafts.
  const conds = [
    eq(products.workspaceId, job.workspace_id),
    eq(products.isDraft, true),
    isNotNull(products.productUrl),
    ne(products.productUrl, ""),
  ];
  if (job.target !== "all") {
    conds.push(or(isNull(products.imageUrl), isNull(products.price))!);
  }
  const targets = await db
    .select({ id: products.id, url: products.productUrl })
    .from(products)
    .where(and(...conds));

  const items = targets
    .filter((t): t is { id: string; url: string } => !!t.url)
    .map((t) => ({ id: t.id, url: t.url }));

  // Reset counters for this (re)run and snapshot the live item set.
  await db
    .update(scrapeJobs)
    .set({ items, total: items.length, done: 0, updatedCount: 0, lastError: null, updatedAt: new Date() })
    .where(eq(scrapeJobs.id, job.id));

  if (items.length === 0) {
    // Nothing left to do — finish immediately so it doesn't sit "running".
    await db.update(scrapeJobs).set({ status: "done", finishedAt: new Date() }).where(eq(scrapeJobs.id, job.id));
    return new Response(null, { status: 204 });
  }

  return jsonCors({ id: job.id, fields: job.fields, items, overwrite: job.overwrite === true });
}
