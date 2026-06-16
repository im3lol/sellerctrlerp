import { ne, desc } from "drizzle-orm";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";
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
import { formatDateAr } from "@/lib/format";

export default async function UsersAdminPage() {
  await requireCapability("employee.manage");

  const staff = await db
    .select()
    .from(users)
    .where(ne(users.role, "client"))
    .orderBy(desc(users.createdAt));

  return (
    <div>
      <PageHeader title="الموظفون" description={`${staff.length} موظف`}>
        <CreateUserDialog triggerLabel="إضافة موظف" />
      </PageHeader>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right">الموظف</TableHead>
              <TableHead className="text-right">الدور</TableHead>
              <TableHead className="text-right">تاريخ الانضمام</TableHead>
              <TableHead className="text-right">نشط</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((u) => {
              const init = u.name.split(" ").slice(0, 2).map((p) => p[0]).join("");
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
                        <AvatarFallback className="bg-primary/10 text-primary">{init}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground" dir="ltr">{u.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary">{ROLE_LABELS_AR[u.role as Role]}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.hiredAt ? formatDateAr(u.hiredAt) : "—"}
                  </TableCell>
                  <TableCell><UserActiveToggle userId={u.id} active={u.isActive} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
