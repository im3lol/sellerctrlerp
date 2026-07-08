"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { addUserToOrgAction, removeUserFromOrgAction } from "@/app/actions/erp/members";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ERP_ROLES = ["admin", "accountant", "inventory", "sales", "purchases", "viewer"];
const ROLE_AR: Record<string, string> = {
  admin: "مدير", accountant: "محاسب", inventory: "مخزون", sales: "مبيعات", purchases: "مشتريات", viewer: "مشاهد",
};

/** Add/change/remove a user's ERP role in the active organization. */
export function OrgMembershipManager({
  userId, orgName, currentRole,
}: { userId: string; orgName: string; currentRole: string | null }) {
  const [pending, start] = useTransition();
  const [role, setRole] = useState(currentRole && currentRole !== "super_admin" ? currentRole : "viewer");

  const save = () => start(async () => {
    const r = await addUserToOrgAction(userId, role);
    if (r.ok) toast.success(currentRole ? "تم تحديث الدور" : `تمت الإضافة إلى ${orgName}`);
    else toast.error(r.error ?? "تعذّر الحفظ");
  });
  const remove = () => start(async () => {
    const r = await removeUserFromOrgAction(userId);
    if (r.ok) toast.success("تمت الإزالة من المؤسسة");
    else toast.error(r.error ?? "تعذّر التنفيذ");
  });

  if (currentRole === "super_admin") {
    return <p className="py-2 text-center text-sm text-muted-foreground">مدير نظام — وصول كامل لكل المؤسسات.</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border p-3">
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">دور ERP في «{orgName}»</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}
          className="flex h-9 w-40 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm">
          {ERP_ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r] ?? r}</option>)}
        </select>
      </div>
      <Button size="sm" disabled={pending} onClick={save}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        {currentRole ? "تحديث الدور" : "إضافة للمؤسسة"}
      </Button>
      {currentRole && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={remove}>
          <Trash2 className="size-4 text-destructive" />إزالة
        </Button>
      )}
      {currentRole && <Badge variant="outline">عضو حالياً: {ROLE_AR[currentRole] ?? currentRole}</Badge>}
    </div>
  );
}
