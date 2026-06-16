import { desc, eq } from "drizzle-orm";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { auditLog, users } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateAr } from "@/lib/format";

const ENTITY_AR: Record<string, string> = {
  product: "منتج",
  task: "مهمة",
  workspace: "مساحة عمل",
  user: "مستخدم",
  attendance: "حضور",
  file: "ملف",
};

export default async function AuditPage() {
  await requireCapability("role.manage");

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      createdAt: auditLog.createdAt,
      before: auditLog.before,
      after: auditLog.after,
      actorName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader title="سجل التدقيق" description="من قام بالتعديل، ومتى، وماذا تغيّر" />
      {rows.length === 0 ? (
        <EmptyState icon="ShieldCheck" title="لا توجد سجلات" />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right">المستخدم</TableHead>
                <TableHead className="text-right">الإجراء</TableHead>
                <TableHead className="text-right">النوع</TableHead>
                <TableHead className="text-right">التغيير</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.actorName ?? "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{ENTITY_AR[r.entityType] ?? r.entityType}</TableCell>
                  <TableCell className="max-w-[280px] truncate font-mono text-xs text-muted-foreground" dir="ltr">
                    {r.before && r.after
                      ? `${JSON.stringify(r.before)} → ${JSON.stringify(r.after)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateAr(r.createdAt, true)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
