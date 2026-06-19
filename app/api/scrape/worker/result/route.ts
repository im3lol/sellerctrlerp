import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { products, productBases, scrapeJobs } from "@/db/schema";
import { scraperTokenOk, buildScrapeUpdate, jsonCors } from "@/lib/scrape";
import { publish } from "@/lib/realtime";

export const runtime = "nodejs";

const query = (text: string, params: unknown[]) => pool.query(text, params);

/**
 * The worker posts one scraped item. We fill ONLY missing fields on the draft
 * product (never overwrite), keep it a draft (reviewer still confirms), and
 * advance the job counters.
 * Body: { jobId, productId, data?: {field: value}, error?: string }
 */
export async function POST(req: Request) {
  if (!scraperTokenOk(req)) return jsonCors({ error: "unauthorized" }, 401);

  let body: { jobId?: string; productId?: string; data?: Record<string, string>; error?: string };
  try {
    body = await req.json();
  } catch {
    return jsonCors({ error: "invalid json" }, 400);
  }
  const { jobId, productId } = body;
  if (!jobId || !productId) return jsonCors({ error: "jobId and productId required" }, 400);

  // Read the job's overwrite mode once.
  const [job] = await db
    .select({ overwrite: scrapeJobs.overwrite })
    .from(scrapeJobs)
    .where(eq(scrapeJobs.id, jobId))
    .limit(1);

  let didUpdate = false;
  if (!body.error && body.data) {
    // Scraped values fill the SHARED base catalog row (single source).
    const [product] = await db
      .select({ workspaceId: products.workspaceId, baseId: products.baseId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (product?.baseId) {
      const [base] = await db.select().from(productBases).where(eq(productBases.id, product.baseId)).limit(1);
      const update = base ? buildScrapeUpdate(base, body.data, job?.overwrite === true) : null;
      if (update) {
        await db
          .update(productBases)
          .set({ ...update, updatedAt: new Date() })
          .where(eq(productBases.id, product.baseId));
        didUpdate = true;
        await publish(query, {
          channel: `workspace:${product.workspaceId}`,
          type: "product_updated",
          payload: { productId, scraped: true },
        });
      }
    }
  }

  await db
    .update(scrapeJobs)
    .set({
      done: sql`${scrapeJobs.done} + 1`,
      updatedCount: sql`${scrapeJobs.updatedCount} + ${didUpdate ? 1 : 0}`,
      lastError: body.error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(scrapeJobs.id, jobId));

  return jsonCors({ ok: true, updated: didUpdate });
}
