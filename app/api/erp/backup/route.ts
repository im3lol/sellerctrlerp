import { eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { getCurrentUser } from "@/lib/session";
import { withOrgScope } from "@/lib/db-scope";
import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { exportOrgData } from "@/lib/erp/backup";
import { tryRecordAudit } from "@/lib/erp/audit";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Self-service "download my data": a full gzipped-JSON backup of the caller's active
 *  org. Gated on settings.edit — only an org admin/owner can export everything. */
export async function GET() {
  const { orgId } = await requireErpModule("settings.edit");
  const userId = (await getCurrentUser())?.id ?? null;
  const [org] = await withOrgScope(orgId, false, () =>
    db.select({ name: organizations.nameAr }).from(organizations).where(eq(organizations.id, orgId)).limit(1));
  const b = await exportOrgData(orgId, org?.name ?? "org");
  await tryRecordAudit({ orgId, userId, action: "CREATE", entityType: "DATA_BACKUP", summary: `تنزيل نسخة احتياطية (${b.totalRows} صف)`, metadata: { tables: b.tableCount, rows: b.totalRows } });
  return new Response(new Uint8Array(b.buffer), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${b.filename}"`,
      "Content-Length": String(b.buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
