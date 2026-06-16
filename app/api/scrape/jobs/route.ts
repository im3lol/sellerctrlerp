import { and, desc, eq, isNull, isNotNull, ne, or, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { scrapeJobs, scrapeRecipes, products } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { canAccessWorkspace } from "@/lib/workspaces";
import { scraperTokenOk, sanitizeFields, corsPreflight, jsonCors, isUuid, type RecipeFields } from "@/lib/scrape";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

async function authorize(req: Request, workspaceId: string): Promise<{ ok: boolean; userId: string | null }> {
  if (scraperTokenOk(req)) return { ok: true, userId: null };
  const user = await getCurrentUser();
  if (user && can(user.role, "product.review") && (await canAccessWorkspace(user, workspaceId))) {
    return { ok: true, userId: user.id };
  }
  return { ok: false, userId: null };
}

/** List recent jobs for a workspace. */
export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!isUuid(workspaceId)) return jsonCors({ error: "معرّف مساحة العمل غير صالح (UUID)" }, 400);
  const { ok } = await authorize(req, workspaceId);
  if (!ok) return jsonCors({ error: "unauthorized" }, 401);

  const rows = await db
    .select({
      id: scrapeJobs.id,
      status: scrapeJobs.status,
      total: scrapeJobs.total,
      done: scrapeJobs.done,
      updatedCount: scrapeJobs.updatedCount,
      lastError: scrapeJobs.lastError,
      createdAt: scrapeJobs.createdAt,
      finishedAt: scrapeJobs.finishedAt,
    })
    .from(scrapeJobs)
    .where(eq(scrapeJobs.workspaceId, workspaceId))
    .orderBy(desc(scrapeJobs.createdAt))
    .limit(20);
  return jsonCors({ jobs: rows });
}

/**
 * Create a scrape job. Snapshots the recipe selectors and the target draft
 * products (those with a URL). The Docker worker then picks it up.
 * Body: { workspaceId, recipeId?, fields?, productIds? }
 */
export async function POST(req: Request) {
  let body: {
    workspaceId?: string;
    recipeId?: string;
    fields?: unknown;
    productIds?: string[];
    mode?: string; // "browser" = run live in the extension tab (skip the Docker worker)
    target?: string; // "incomplete" (default, resume-safe) | "all"
    overwrite?: boolean; // re-scrape: overwrite existing fields
  };
  try {
    body = await req.json();
  } catch {
    return jsonCors({ error: "invalid json" }, 400);
  }
  const workspaceId = String(body.workspaceId ?? "");
  if (!isUuid(workspaceId)) return jsonCors({ error: "معرّف مساحة العمل غير صالح (UUID)" }, 400);
  const { ok, userId } = await authorize(req, workspaceId);
  if (!ok) return jsonCors({ error: "unauthorized" }, 401);

  // Resolve the selectors: from a saved recipe, or inline fields.
  let fields: RecipeFields = sanitizeFields(body.fields);
  if (body.recipeId) {
    const [r] = await db
      .select()
      .from(scrapeRecipes)
      .where(and(eq(scrapeRecipes.id, body.recipeId), eq(scrapeRecipes.workspaceId, workspaceId)))
      .limit(1);
    if (r) fields = r.fields;
  }
  if (Object.keys(fields).length === 0) return jsonCors({ error: "no selectors (recipeId or fields)" }, 400);

  // "incomplete" (default) targets only drafts still missing a core field, so a
  // re-run after a crash resumes on the leftovers. "all" re-scrapes everything.
  const target = body.target === "all" ? "all" : "incomplete";
  const overwrite = body.overwrite === true;

  const conds = [
    eq(products.workspaceId, workspaceId),
    eq(products.isDraft, true),
    isNotNull(products.productUrl),
    ne(products.productUrl, ""),
  ];
  if (target === "incomplete") {
    conds.push(or(isNull(products.imageUrl), isNull(products.price))!);
  }
  if (body.productIds?.length) conds.push(inArray(products.id, body.productIds));

  const targets = await db
    .select({ id: products.id, url: products.productUrl })
    .from(products)
    .where(and(...conds));

  const items = targets
    .filter((t): t is { id: string; url: string } => !!t.url)
    .map((t) => ({ id: t.id, url: t.url }));

  if (items.length === 0) return jsonCors({ error: "لا توجد منتجات مسودة بلينك للسحب" }, 400);

  // Browser mode runs live in the extension tab — mark it running so the Docker
  // worker (which only claims "pending") leaves it alone.
  const browserMode = body.mode === "browser";

  const [job] = await db
    .insert(scrapeJobs)
    .values({
      workspaceId,
      recipeId: body.recipeId ?? null,
      fields,
      items,
      total: items.length,
      status: browserMode ? "running" : "pending",
      runner: browserMode ? "browser" : "worker",
      target,
      overwrite,
      startedAt: browserMode ? new Date() : null,
      createdById: userId,
    })
    .returning({ id: scrapeJobs.id });

  return jsonCors({ jobId: job.id, total: items.length, items, fields });
}
