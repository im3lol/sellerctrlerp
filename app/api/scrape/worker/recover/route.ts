import { pool } from "@/lib/db";
import { scraperTokenOk, jsonCors } from "@/lib/scrape";

export const runtime = "nodejs";

/**
 * Called by the worker on startup. Any worker job left "running" (because the
 * worker / Docker / server stopped mid-run) is requeued to "pending" so it
 * resumes. Browser-driven jobs are left untouched. On reclaim, worker/next
 * recomputes the remaining incomplete drafts — so nothing already done repeats.
 */
export async function POST(req: Request) {
  if (!scraperTokenOk(req)) return jsonCors({ error: "unauthorized" }, 401);

  const { rowCount } = await pool.query(
    `UPDATE scrape_jobs
        SET status = 'pending', started_at = NULL, updated_at = now()
      WHERE status = 'running' AND runner = 'worker'`,
  );

  return jsonCors({ ok: true, requeued: rowCount ?? 0 });
}
