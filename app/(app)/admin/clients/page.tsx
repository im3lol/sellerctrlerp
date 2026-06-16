import { eq, sql, desc } from "drizzle-orm";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { users, workspaces } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { UserActiveToggle } from "@/components/admin/user-active-toggle";
import { EmptyState } from "@/components/empty-state";

export default async function ClientsAdminPage() {
  await requireCapability("client.manage");

  const clients = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      isActive: users.isActive,
      workspaceCount: sql<number>`count(${workspaces.id})::int`,
    })
    .from(users)
    .leftJoin(workspaces, eq(workspaces.clientUserId, users.id))
    .where(eq(users.role, "client"))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  return (
    <div>
      <PageHeader title="العملاء" description={`${clients.length} عميل`}>
        <CreateUserDialog clientOnly triggerLabel="إضافة عميل" />
      </PageHeader>

      {clients.length === 0 ? (
        <EmptyState icon="Store" title="لا يوجد عملاء" description="أضف عميلاً جديداً للبدء." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right">العميل</TableHead>
                <TableHead className="text-right">مساحات العمل</TableHead>
                <TableHead className="text-right">نشط</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => {
                const init = c.name.split(" ").slice(0, 2).map((p) => p[0]).join("");
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                          {c.avatarUrl && <AvatarImage src={c.avatarUrl} />}
                          <AvatarFallback className="bg-brand-yellow/20 text-amber-700">{init}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">{c.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="secondary">{c.workspaceCount} مساحة</Badge></TableCell>
                    <TableCell><UserActiveToggle userId={c.id} active={c.isActive} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
