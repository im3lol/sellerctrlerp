import { Fragment } from "react";
import { and, eq, ne } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { organizationMembers, users } from "@/db/schema";
import { allErpPermissions, erpRolePermissions, erpRoleLabels } from "@/lib/erp/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { PermissionsMembers, type Member } from "@/components/erp/permissions-members";

/** Assignable org roles (super_admin comes from a global system_admin, not here). */
const ASSIGNABLE = ["admin", "accountant", "sales", "purchase", "inventory", "viewer"];
const MATRIX_ROLES = ["super_admin", ...ASSIGNABLE];
const ROLE_LABELS: Record<string, string> = { super_admin: "مدير النظام", ...erpRoleLabels };

const MODULES: { key: string; label: string }[] = [
  { key: "sales", label: "المبيعات" },
  { key: "purchases", label: "المشتريات" },
  { key: "inventory", label: "المخزون" },
  { key: "accounting", label: "المحاسبة" },
  { key: "reports", label: "التقارير" },
  { key: "investors", label: "المستثمرون" },
  { key: "hr", label: "الموارد البشرية" },
  { key: "settings", label: "الإعدادات" },
  { key: "users", label: "المستخدمون" },
  { key: "organization", label: "المؤسسة" },
];
const ACTION_LABEL: Record<string, string> = {
  view: "عرض", create: "إنشاء", edit: "تعديل", delete: "حذف", confirm: "تأكيد",
  post: "ترحيل", reverse: "عكس القيود", collect: "تحصيل", pay: "سداد", manage: "إدارة كاملة",
};

export default async function PermissionsPage() {
  const { orgId } = await requireErpModule("settings.view");
  const user = await requireUser();
  const canManage = can(user.role, "employee.manage");

  const [memberRows, allUsers] = await Promise.all([
    db.select({ userId: organizationMembers.userId, role: organizationMembers.role, name: users.name, email: users.email, osRole: users.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)))
      .orderBy(users.name),
    db.select({ id: users.id, name: users.name, email: users.email })
      .from(users).where(and(eq(users.isActive, true), ne(users.role, "client"))).orderBy(users.name),
  ]);

  const members: Member[] = memberRows.map((m) => ({
    userId: m.userId, name: m.name, email: m.email, role: m.role, isSystemAdmin: m.osRole === "system_admin",
  }));
  const memberIds = new Set(members.map((m) => m.userId));
  const nonMembers = allUsers.filter((u) => !memberIds.has(u.id));

  const rolePerms: Record<string, string[]> = { super_admin: allErpPermissions, ...erpRolePermissions };
  const roleOptions = ASSIGNABLE.map((r) => ({ value: r, label: erpRoleLabels[r] ?? r }));

  const groups = MODULES.map((mod) => ({
    ...mod,
    perms: allErpPermissions.filter((p) => p.startsWith(`${mod.key}.`)).map((p) => ({ key: p, action: ACTION_LABEL[p.split(".")[1]] ?? p.split(".")[1] })),
  })).filter((g) => g.perms.length > 0);

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="ShieldCheck" title="صلاحيات المستخدمين" subtitle="تعيين أدوار الأعضاء ومعرفة تفاصيل ما يسمح به كل دور" backHref="/erp/settings" />

      <PermissionsMembers members={members} nonMembers={nonMembers} roleOptions={roleOptions} roleLabels={ROLE_LABELS} canManage={canManage} />

      <Card>
        <CardHeader>
          <CardTitle>مصفوفة الصلاحيات التفصيلية</CardTitle>
          <CardDescription>ما يسمح به كل دور بالضبط، مقسّماً حسب الموديول والإجراء. ✓ = مسموح.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr className="[&>th]:whitespace-nowrap [&>th]:p-2.5 [&>th]:text-start">
                  <th className="min-w-40">الصلاحية</th>
                  {MATRIX_ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABELS[r] ?? r}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-muted/20">
                      <td colSpan={MATRIX_ROLES.length + 1} className="p-2 ps-3 text-xs font-bold text-primary">{g.label}</td>
                    </tr>
                    {g.perms.map((p) => (
                      <tr key={p.key} className="border-t [&>td]:p-2.5">
                        <td className="ps-4 text-muted-foreground">{p.action}</td>
                        {MATRIX_ROLES.map((r) => (
                          <td key={r} className="text-center">
                            {rolePerms[r]?.includes(p.key)
                              ? <Icon name="Check" className="mx-auto size-4 text-emerald-600" />
                              : <span className="text-muted-foreground/30">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
