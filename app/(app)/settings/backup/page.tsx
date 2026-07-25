import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { listBackups } from "@/lib/erp/backup";

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ك.ب` : `${(b / 1024 / 1024).toFixed(1)} م.ب`);
const bdt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "short", day: "numeric" });

export default async function BackupSettingsPage() {
  return loadErpPage("settings.edit", async ({ orgId }) => {
    const backups = await listBackups(orgId, 8);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="DatabaseBackup" title="النسخ الاحتياطي" subtitle="نسخة كاملة من بيانات مؤسستك — تحميل فوري أو نسخ محفوظة تلقائياً" backHref="/settings" />
        <Card>
          <CardHeader>
            <CardTitle>نسخة احتياطية من بياناتك</CardTitle>
            <CardDescription>حمّل نسخة كاملة من بيانات مؤسستك (كل الجداول) كملف مضغوط — احتفظ بها أو انقلها متى شئت.</CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/api/erp/backup" download className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <Icon name="Download" className="size-4" />تحميل نسخة من بياناتي
            </a>
            {backups.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <div className="mb-2 text-sm font-medium text-muted-foreground">نسخ محفوظة تلقائيًا</div>
                <ul className="divide-y">
                  {backups.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-muted-foreground">{bdt(b.createdAt)} · {fmtBytes(b.sizeBytes)}</span>
                      <a href={`/api/erp/backups/${b.id}`} className="text-primary hover:underline">تنزيل</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
