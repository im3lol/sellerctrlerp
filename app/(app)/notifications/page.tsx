import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { notifications } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { NotificationsList } from "@/components/notifications/notifications-list";

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return (
    <div>
      <PageHeader title="الإشعارات" description="كل التنبيهات الخاصة بك" />
      {items.length === 0 ? (
        <EmptyState icon="Bell" title="لا توجد إشعارات" />
      ) : (
        <NotificationsList items={items} />
      )}
    </div>
  );
}
