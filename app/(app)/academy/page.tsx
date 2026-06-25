import { desc, eq, sql, inArray } from "drizzle-orm";
import { requireHrAccess } from "@/lib/hr/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { academyItems, academyViews } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { AcademyView } from "@/components/academy/academy-view";

export default async function AcademyPage() {
  const { user } = await requireHrAccess();
  const canManage = can(user.role, "employee.manage");

  const items = await db
    .select()
    .from(academyItems)
    .orderBy(desc(academyItems.createdAt));

  const ids = items.map((i) => i.id);
  const [counts, mine] = await Promise.all([
    canManage && ids.length
      ? db
          .select({ itemId: academyViews.itemId, count: sql<number>`count(*)::int` })
          .from(academyViews)
          .where(inArray(academyViews.itemId, ids))
          .groupBy(academyViews.itemId)
      : Promise.resolve([] as { itemId: string; count: number }[]),
    ids.length
      ? db
          .select({ itemId: academyViews.itemId })
          .from(academyViews)
          .where(eq(academyViews.userId, user.id))
      : Promise.resolve([] as { itemId: string }[]),
  ]);

  const countMap = new Map(counts.map((c) => [c.itemId, c.count]));
  const mineSet = new Set(mine.map((m) => m.itemId));

  const data = items.map((i) => ({
    id: i.id,
    type: i.type as "article" | "video" | "tip",
    title: i.title,
    body: i.body,
    youtubeUrl: i.youtubeUrl,
    category: i.category,
    viewCount: countMap.get(i.id) ?? 0,
    viewed: mineSet.has(i.id),
  }));

  return (
    <div>
      <PageHeader title="الأكاديمية" description="مقالات وفيديوهات ونصائح لتطوير الفريق" />
      <AcademyView items={data} canManage={canManage} />
    </div>
  );
}
