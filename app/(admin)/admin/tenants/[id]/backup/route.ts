import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/session";
import { withPlatformScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { exportOrgData } from "@/lib/erp/backup";
import { tryRecordAudit } from "@/lib/erp/audit";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Owner download of any tenant's full backup (system_admin only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const [org] = await withPlatformScope(() =>
    db.select({ name: organizations.nameAr }).from(organizations).where(eq(organizations.id, id)).limit(1));
  if (!org) return new Response("Not found", { status: 404 });
  const b = await exportOrgData(id, org.name);
  await tryRecordAudit({ orgId: id, userId: user.id, action: "CREATE", entityType: "DATA_BACKUP", summary: `المشرف نزّل نسخة احتياطية (${b.totalRows} صف)`, metadata: { tables: b.tableCount, rows: b.totalRows } });
  return new Response(new Uint8Array(b.buffer), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${b.filename}"`,
      "Content-Length": String(b.buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
