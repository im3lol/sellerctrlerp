import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productBases } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { canAccessWorkspace } from "@/lib/workspaces";
import { scraperTokenOk, corsPreflight, jsonCors, isUuid } from "@/lib/scrape";

export const runtime = "nodejs";

export function OPTIONS() {
  return corsPreflight();
}

/** List draft (incomplete-data) products that have a product URL to scrape. */
export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!isUuid(workspaceId)) return jsonCors({ error: "معرّف مساحة العمل غير صالح (UUID)" }, 400);

  // Auth: worker/extension token OR a logged-in reviewer with workspace access.
  if (!scraperTokenOk(req)) {
    const user = await getCurrentUser();
    if (!user || !can(user.role, "product.review") || !(await canAccessWorkspace(user, workspaceId))) {
      return jsonCors({ error: "unauthorized" }, 401);
    }
  }

  const rows = await db
    .select({ id: products.id, name: productBases.name, url: productBases.productUrl })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        eq(products.isDraft, true),
        isNotNull(productBases.productUrl),
        ne(productBases.productUrl, ""),
      ),
    );

  return jsonCors({ products: rows });
}
