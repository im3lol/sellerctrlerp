import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { users, organizationMembers, organizations } from "@/db/schema";
import { ROLE_LABELS_AR, type Role } from "@/lib/rbac";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDateAr } from "@/lib/format";

const ERP_ROLE_AR: Record<string, string> = {
  super_admin: "مدير النظام", admin: "مدير", accountant: "محاسب", inventory: "مخزون", sales: "مبيعات", purchases: "مشتريات", viewer: "مشاهد",
};

export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability("employee.manage");
  const { id } = await params;

  const [u] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!u) notFound();

  const memberships = await db
    .select({ id: organizations.id, nameAr: organizations.nameAr, role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, id));

  const init = u.name.split(" ").slice(0, 2).map((p) => p[0]).join("");

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/admin/users" className="hover:text-foreground">المستخدمون</Link>
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-foreground">{u.name}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col items-center gap-3 p-6 text-center lg:col-span-1">
          <Avatar className="size-20">
            {u.avatarUrl && <AvatarImage src={u.avatarUrl} />}
            <AvatarFallback className="bg-primary/10 text-xl text-primary">{init}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-lg font-bold">{u.name}</p>
            <p className="text-sm text-muted-foreground" dir="ltr">{u.email}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Badge variant="secondary">{ROLE_LABELS_AR[u.role as Role] ?? u.role}</Badge>
            <Badge variant={u.isActive ? "default" : "outline"}>{u.isActive ? "نشط" : "غير نشط"}</Badge>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card className="space-y-3 p-5 text-sm">
            <Row label="المسمى الوظيفي" value={u.title ?? "—"} />
            <Row label="الدور" value={ROLE_LABELS_AR[u.role as Role] ?? u.role} />
            <Row label="تاريخ الانضمام" value={u.hiredAt ? formatDateAr(u.hiredAt) : "—"} />
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-semibold">المؤسسات وأدوار ERP</h2>
            {memberships.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">غير مضاف لأي مؤسسة.</p>
            ) : (
              <div className="space-y-2">
                {memberships.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-xl border p-3 text-sm">
                    <span className="font-medium">{m.nameAr}</span>
                    <Badge variant="outline">{ERP_ROLE_AR[m.role] ?? m.role}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
