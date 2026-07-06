import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { initializeAccountingForOrg } from "@/lib/erp/default-chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-time tenant setup: bootstrap the standard chart of accounts (plus default
 * journals and an OPEN fiscal period) for every organization that has none.
 * Additive and idempotent — never deletes or overwrites existing data.
 *
 * Gated by the `INIT_SETUP_TOKEN` env var (sent as `Authorization: Bearer <token>`
 * or `?token=`). When the env var is unset the endpoint is disabled (403), so it
 * can be permanently retired by removing the variable after use.
 */
export async function GET(req: Request) {
  const token = process.env.INIT_SETUP_TOKEN;
  if (!token) return Response.json({ error: "disabled" }, { status: 403 });

  const url = new URL(req.url);
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("token") ?? "";
  if (provided !== token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const orgs = await db.select({ id: organizations.id, nameAr: organizations.nameAr }).from(organizations);
  const results: Array<{ org: string; nameAr: string } & Awaited<ReturnType<typeof initializeAccountingForOrg>>> = [];
  for (const org of orgs) {
    const r = await initializeAccountingForOrg(org.id);
    results.push({ org: org.id, nameAr: org.nameAr, ...r });
  }
  return Response.json({ ok: true, orgs: results.length, results });
}
