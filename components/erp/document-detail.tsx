import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** UUID matcher — public document URLs use the readable number; UUID links redirect. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
export async function LinkedDocsCard({ links }: { links: DocLink[] }) {
  const t = await getT();
  const present = links.filter((l) => l.number);
  if (present.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("المستندات المرتبطة")}</CardTitle>
        <CardDescription>{t("تنقّل عبر دورة المستند.")}</CardDescription>
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
