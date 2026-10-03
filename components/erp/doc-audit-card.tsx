"use client";

import { useT } from "@/lib/i18n/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import type { AuditRow } from "@/lib/erp/audit";

const dtt = (d: Date) =>
  new Date(d).toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export const ACTION_AR: Record<string, string> = {
  CREATE: "إنشاء", CONFIRM: "تأكيد", POST: "ترحيل", CONVERT: "تحويل",
  CANCEL: "إلغاء", REVERSE: "عكس", DELETE: "حذف", UPDATE: "تعديل",
  SUBMIT: "طلب اعتماد", APPROVE: "اعتماد", REJECT: "رفض",
};

/** "سجل التدقيق" for one document. */
export function DocAuditCard({ rows }: { rows: AuditRow[] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="ScrollText" className="size-4" /> {t("سجل التدقيق")}</CardTitle>
        <CardDescription>{t("كل حدث على هذا المستند.")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">{t("لا توجد أحداث مسجّلة.")}</div>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 text-sm">
                <Badge variant="outline" className="mt-0.5 shrink-0">{ACTION_AR[r.action] ? t(ACTION_AR[r.action]) : r.action}</Badge>
                <div>
                  <div>{r.summary ?? "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono">{dtt(r.createdAt)} · {r.userName ?? t("تلقائي (النظام)")}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
