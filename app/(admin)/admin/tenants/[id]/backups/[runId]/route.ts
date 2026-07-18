import { getCurrentUser } from "@/lib/session";
import { withPlatformScope } from "@/lib/db-scope";
import { backupKeyFor } from "@/lib/erp/backup";
import { presignDownload } from "@/lib/storage";

export const runtime = "nodejs";

/** Owner download of a tenant's stored backup via a short-lived signed URL. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") return new Response("Unauthorized", { status: 401 });
  const { id, runId } = await params;
  const key = await withPlatformScope(() => backupKeyFor(id, runId));
  if (!key) return new Response("Not found", { status: 404 });
  return Response.redirect(await presignDownload(key, 300), 302);
}
