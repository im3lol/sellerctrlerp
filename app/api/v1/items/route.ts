import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { resolveOrgByApiKey, apiKeyFromRequest } from "@/lib/erp/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/items — the org's active items. Auth: Bearer <api key> or x-api-key. */
export async function GET(req: Request) {
  const orgId = await resolveOrgByApiKey(apiKeyFromRequest(req));
  if (!orgId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select({
    id: items.id, code: items.code, name: items.nameAr, sellPrice: items.sellPrice, minStock: items.minStock,
  }).from(items).where(and(eq(items.organizationId, orgId), eq(items.isActive, true))).orderBy(asc(items.code));

  return Response.json({ data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, sellPrice: Number(r.sellPrice), minStock: Number(r.minStock) })) });
}
