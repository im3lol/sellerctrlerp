import { listChangelogForAdmin } from "@/lib/erp/changelog";
import { PageHeader } from "@/components/page-header";
import { ChangelogManager } from "@/components/admin/changelog-manager";

/** Where release notes get written. Platform content — every tenant reads the same list. */
export default async function AdminChangelogPage() {
  const rows = await listChangelogForAdmin();

  // The <input type="date"> wants yyyy-mm-dd, and the date is the sort key the whole
  // page hangs on, so keep the conversion in one place rather than in the client.
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const entries = rows.map((e) => ({
    id: e.id, title: e.title, body: e.body, kind: e.kind,
    module: e.module, releasedAt: iso(e.releasedAt), isPublished: e.isPublished,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="آخر التحديثات"
        description="ملاحظات الإصدار كما يقرأها كل العملاء. المسودة تتكتب دلوقتي وتتنشر لما تشحن." />
      <ChangelogManager entries={entries} today={iso(new Date())} />
    </div>
  );
}
