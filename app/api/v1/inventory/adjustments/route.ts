import { authorizeApi, isApiError, runAsErp } from "@/lib/erp/api-auth";
import { createAdjustment, confirmAdjustment, deleteAdjustmentDraft } from "@/lib/erp/inventory-writes";
import { stockAdjustmentList } from "@/lib/erp/mobile-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/v1/inventory/adjustments — stock adjustment documents list. */
export async function GET(req: Request) {
  const auth = await authorizeApi(req, "inventory.view");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ data: await stockAdjustmentList(auth.orgId) });
}

/**
 * POST /api/v1/inventory/adjustments — mobile stock count: create + post in one
 * shot. Body: { warehouseId, reason?, lines: [{ itemId, countedQty }] }.
 * Each line sets the item's on-hand in that warehouse to countedQty (mode=set).
 */
export async function POST(req: Request) {
  const auth = await authorizeApi(req, "inventory.create");
  if (isApiError(auth)) return Response.json({ error: auth.error }, { status: auth.status });
  if (!auth.can("inventory.confirm")) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: { warehouseId?: string; reason?: string; lines?: { itemId?: string; countedQty?: number }[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const warehouseId = String(body.warehouseId ?? "");
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!warehouseId || lines.length === 0) return Response.json({ error: "warehouse_and_lines_required" }, { status: 400 });

  const input = {
    date: new Date().toISOString(),
    reason: (body.reason && body.reason.trim()) || "جرد عبر تطبيق الموبايل",
    lines: lines.map((l) => ({ itemId: String(l.itemId ?? ""), warehouseId, mode: "set" as const, value: Number(l.countedQty ?? 0) })),
  };

  // runAsErp opens the tenant DB scope the inventory writes need — without it they run
  // on the bare pool and RLS blocks the write (every sibling /api/v1 write does this).
  return runAsErp(auth, async () => {
    const created = await createAdjustment(auth.orgId, auth.userId, input);
    if ("error" in created) return Response.json({ error: created.error }, { status: 400 });

    const posted = await confirmAdjustment(auth.orgId, auth.userId, created.id);
    if ("error" in posted) {
      await deleteAdjustmentDraft(auth.orgId, created.id); // roll back the unposted draft
      return Response.json({ error: posted.error }, { status: 400 });
    }

    return Response.json({ ok: true, id: created.id });
  });
}
