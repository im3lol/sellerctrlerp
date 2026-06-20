import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import type { AuditRow } from "@/lib/erp/audit";

/** UUID matcher — public document URLs use the readable number; UUID links redirect. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dtt = (d: Date) =>
  new Date(d).toLocaleString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const ACTION_AR: Record<string, string> = {
  CREATE: "إنشاء", CONFIRM: "تأكيد", POST: "ترحيل", CONVERT: "تحويل",
  CANCEL: "إلغاء", REVERSE: "عكس", DELETE: "حذف", UPDATE: "تعديل",
};

/** A labelled read-only field tile. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}

export type DocLink = { label: string; number: string | null; href: string | null };

/** "المستندات المرتبطة" — prev/next documents in the cycle. Renders nothing if all empty. */
export function LinkedDocsCard({ links }: { links: DocLink[] }) {
  const present = links.filter((l) => l.number);
  if (present.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>المستندات المرتبطة</CardTitle>
        <CardDescription>تنقّل عبر دورة المستند.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {present.map((l) => (
          <div key={l.label} className="rounded-lg border px-3 py-2 text-sm">
            <span className="text-muted-foreground">{l.label}: </span>
            {l.href ? (
              <Link href={l.href} className="font-mono font-medium text-primary underline">{l.number}</Link>
            ) : (
              <span className="font-mono font-medium">{l.number}</span>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** "سجل التدقيق" for one document. */
export function DocAuditCard({ rows }: { rows: AuditRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="ScrollText" className="size-4" /> سجل التدقيق</CardTitle>
        <CardDescription>كل حدث على هذا المستند.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">لا توجد أحداث مسجّلة.</div>
        ) : (
          <ol className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 text-sm">
                <Badge variant="outline" className="mt-0.5 shrink-0">{ACTION_AR[r.action] ?? r.action}</Badge>
                <div>
                  <div>{r.summary ?? "—"}</div>
                  <div className="text-xs text-muted-foreground font-mono">{dtt(r.createdAt)} · {r.userName ?? "—"}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
