import { listAllLessonsForAdmin } from "@/lib/erp/academy";
import { PageHeader } from "@/components/page-header";
import { AcademyManager } from "@/components/admin/academy-manager";

/**
 * Where the platform owner writes the academy. Lessons are product content — one
 * copy, seen by every tenant — so this is the only place they're edited.
 *
 * Guarded by the (admin) layout (system_admin only); the actions re-check
 * employee.manage on the write path.
 */
export default async function AdminAcademyPage() {
  const rows = await listAllLessonsForAdmin();
  const list = rows.map((l) => ({
    id: l.id, slug: l.slug, title: l.title, module: l.module,
    outcome: l.outcome, url: l.url, body: l.body, minutes: l.minutes,
    level: l.level, sortOrder: l.sortOrder, isActive: l.isActive,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="الأكاديمية"
        description="دروس شرح النظام كما يراها كل العملاء. الدرس يبقى متاحًا بفيديو أو شرح مكتوب — بدون الاتنين يظهر «قريباً»." />
      <AcademyManager lessons={list} />
    </div>
  );
}
