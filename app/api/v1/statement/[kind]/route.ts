import { authorizeApi, isApiError } from "@/lib/erp/api-auth";
import { accountLedger, customerStatement, supplierStatement, type Statement } from "@/lib/erp/mobile-statements";
import type { ErpPermission } from "@/lib/erp/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTRY: Record<string, { perm: ErpPermission; fn: (orgId: string, id: string, from?: string, to?: string) => Promise<Statement | null> }> = {
  account: { perm: "accounting.view", fn: accountLedger },   // دفتر الأستاذ
  customer: { perm: "accounting.view", fn: customerStatement },
  supplier: { perm: "accounting.view", fn: supplierStatement },
};

/** GET /api/v1/statement/:kind?id&from&to — ledger / party statement with a running balance. */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const entry = REGISTRY[kind];
  if (!entry) return Response.json({ error: "unknown_statement" }, { status: 404 });
  const auth = await authorizeApi(req, entry.perm);
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") ?? "";
  if (!id) return Response.json({ error: "id مطلوب" }, { status: 400 });
  const st = await entry.fn(auth.orgId, id, sp.get("from") || undefined, sp.get("to") || undefined);
  if (!st) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ data: st });
}
