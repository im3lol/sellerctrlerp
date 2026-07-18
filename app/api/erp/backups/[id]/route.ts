import { requireErpModule } from "@/lib/erp/org";
import { withOrgScope } from "@/lib/db-scope";
import { backupKeyFor } from "@/lib/erp/backup";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

/** Download a stored (scheduled) backup of the caller's org via a short-lived signed URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireErpModule("settings.edit");
  const { id } = await params;
  const key = await withOrgScope(orgId, false, () => backupKeyFor(orgId, id));
  if (!key) return new Response("Not found", { status: 404 });
  return Response.redirect(await presignDownload(key, 300), 302);
}
